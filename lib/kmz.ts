import { inflateRawSync } from "zlib";

// KMZ é um ZIP que contém um doc.kml. Extrai o KML interno sem dependências
// externas, lendo o diretório central do ZIP e inflando a entrada .kml.

const SIG_EOCD = 0x06054b50; // End of Central Directory
const SIG_CEN = 0x02014b50; // Central Directory header
const SIG_LOC = 0x04034b50; // Local file header

export function extractKmlFromKmz(buf: Buffer): string {
  // Localiza o EOCD varrendo do fim (após o comentário opcional).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("KMZ inválido (não é um ZIP)");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries: { name: string; method: number; compSize: number; localOff: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CEN) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + fnLen);
    entries.push({ name, method, compSize, localOff });
    off += 46 + fnLen + extraLen + commentLen;
  }

  // Prefere doc.kml; senão o primeiro .kml encontrado.
  const entry =
    entries.find((e) => e.name.toLowerCase() === "doc.kml") ??
    entries.find((e) => e.name.toLowerCase().endsWith(".kml"));
  if (!entry) throw new Error("KMZ sem arquivo .kml interno");

  // Lê o cabeçalho local da entrada para achar onde começam os dados.
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== SIG_LOC) throw new Error("KMZ com cabeçalho local inválido");
  const fnLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + fnLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);

  if (entry.method === 0) return data.toString("utf8"); // armazenado (sem compressão)
  if (entry.method === 8) return inflateRawSync(data).toString("utf8"); // deflate
  throw new Error(`KMZ com compressão não suportada (método ${entry.method})`);
}
