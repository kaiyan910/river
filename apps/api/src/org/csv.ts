/** CSV 的一筆記錄；line 是這筆記錄開始的行號（從 1 起算）。 */
export type CsvRecord =
  | { line: number; fields: string[]; error?: undefined }
  | { line: number; fields?: undefined; error: string };

/**
 * 解析以逗號分隔的 CSV（RFC 4180）：雙引號包住的欄位可以含逗號、換行，`""` 代表一個雙引號；
 * 換行可以是 CRLF、LF 或 CR。開頭的 BOM（Excel 存出的 UTF-8 CSV）會被略過。
 *
 * 某一筆記錄的引號位置錯誤時，這筆記錄回傳 error 並從下一行繼續；引號沒有結束時，其後的內容都屬於這筆記錄。
 * 完全空白的行不回傳。
 */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  let i = 0;
  let line = 1;

  while (i < input.length) {
    const start = line;
    const fields: string[] = [];
    let field = '';
    let error: string | undefined;

    // 讀一筆記錄，直到記錄結尾的換行或檔案結尾。
    record: for (;;) {
      if (input[i] === '"') {
        i++;
        for (;;) {
          if (i >= input.length) {
            error = '引號沒有結束';
            break record;
          }
          const c = input[i];
          if (c === '"') {
            if (input[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (c === '\n' || (c === '\r' && input[i + 1] !== '\n')) line++;
          field += c;
          i++;
        }
        const next = input[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          error = '引號後面必須是逗號或換行';
          break;
        }
      } else {
        while (i < input.length && !',\r\n'.includes(input[i] as string)) {
          if (input[i] === '"') {
            error = '沒有用引號包住的欄位不能含有引號';
            break record;
          }
          field += input[i];
          i++;
        }
      }

      fields.push(field);
      field = '';
      if (input[i] === ',') {
        i++;
        continue;
      }
      break;
    }

    if (error) {
      // 略過這一行剩下的內容，從下一行繼續。
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i++;
    }
    // 引號內的換行已經計入 line，這裡再加上記錄結尾的換行。
    i = skipLineBreak(input, i);
    line++;

    if (error) records.push({ line: start, error });
    else if (fields.some((f) => f.trim() !== '')) records.push({ line: start, fields });
  }
  return records;
}

function skipLineBreak(input: string, i: number): number {
  if (input[i] === '\r' && input[i + 1] === '\n') return i + 2;
  if (input[i] === '\r' || input[i] === '\n') return i + 1;
  return i;
}
