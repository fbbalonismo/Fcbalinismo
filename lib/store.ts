import { del, list, put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

// Armazenamento com dois back-ends:
//  - Produção/Vercel: usa o Vercel Blob (quando BLOB_READ_WRITE_TOKEN existe).
//  - Dev local (sem token): grava e lê arquivos em ./.data, para que upload de
//    GPX e registro de chuva funcionem sem nenhuma credencial externa.

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const DATA_DIR = path.join(process.cwd(), ".data");

// Salva um texto (JSON, GPX, etc.) no caminho lógico informado (ex.: "voos/x.json").
export async function saveText(
  pathname: string,
  text: string,
  contentType: string
): Promise<void> {
  if (useBlob) {
    await put(pathname, text, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return;
  }
  const full = path.join(DATA_DIR, pathname);
  try {
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text, "utf8");
  } catch (e) {
    // Em produção serverless (FS read-only) sem token, a gravação local falha —
    // dá um erro claro apontando a configuração, em vez de um EROFS cru.
    const code = (e as { code?: string })?.code;
    if (code === "EROFS" || code === "EACCES") {
      throw new Error(
        "Armazenamento indisponível: defina BLOB_READ_WRITE_TOKEN para gravar em produção (o modo local só funciona em dev)."
      );
    }
    throw e;
  }
}

// Lê e faz parse de todos os .json sob um prefixo (ex.: "voos/", "chuva/").
export async function listJson<T>(prefix: string): Promise<T[]> {
  if (useBlob) {
    const { blobs } = await list({ prefix, limit: 1000 });
    const items = (await Promise.all(
      blobs
        .filter((b) => b.pathname.endsWith(".json"))
        .map(async (b): Promise<T | null> => {
          try {
            return (await (await fetch(b.url)).json()) as T;
          } catch {
            return null;
          }
        })
    )) as (T | null)[];
    return items.filter((x): x is T => x !== null);
  }

  const dir = path.join(DATA_DIR, prefix);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // pasta ainda não existe = nenhum registro
  }
  const items = (await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n): Promise<T | null> => {
        try {
          return JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as T;
        } catch {
          return null;
        }
      })
  )) as (T | null)[];
  return items.filter((x): x is T => x !== null);
}

// Remove um objeto (ex.: assinatura de push expirada). Best-effort.
export async function deleteObject(pathname: string): Promise<void> {
  if (useBlob) {
    try {
      await del(pathname);
    } catch {}
    return;
  }
  try {
    await fs.unlink(path.join(DATA_DIR, pathname));
  } catch {}
}
