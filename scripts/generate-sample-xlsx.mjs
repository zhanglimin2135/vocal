import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const unit1 = [
  ['word', 'meaning'],
  ['abandon', '放弃；抛弃'],
  ['ability', '能力；才能'],
  ['absorb', '吸收；吸引'],
  ['abstract', '抽象的；摘要'],
  ['abundant', '丰富的；充裕的'],
  ['academy', '学院；研究院'],
  ['accelerate', '加速；促进'],
  ['accent', '口音；重音'],
  ['accept', '接受；认可'],
  ['access', '进入；使用权'],
];

const unit2 = [
  ['单词', '释义'],
  ['accident', '事故；意外'],
  ['accompany', '陪伴；伴随'],
  ['accomplish', '完成；实现'],
  ['account', '账户；说明'],
  ['accurate', '精确的；准确的'],
  ['achieve', '达到；实现'],
  ['acknowledge', '承认；致谢'],
  ['acquire', '获得；取得'],
  ['adapt', '适应；改编'],
  ['adequate', '足够的；适当的'],
];

const unit3 = [
  ['English', '中文'],
  ['adjust', '调整；适应'],
  ['admire', '钦佩；赞美'],
  ['admission', '承认；入场'],
  ['adopt', '采用；收养'],
  ['advance', '前进；进步'],
  ['advantage', '优势；好处'],
  ['adventure', '冒险；奇遇'],
  ['advertise', '做广告；宣传'],
  ['advise', '建议；忠告'],
  ['affect', '影响；感动'],
];

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet(unit1);
const ws2 = XLSX.utils.aoa_to_sheet(unit2);
const ws3 = XLSX.utils.aoa_to_sheet(unit3);
XLSX.utils.book_append_sheet(wb, ws1, 'Unit 1');
XLSX.utils.book_append_sheet(wb, ws2, 'Unit 2');
XLSX.utils.book_append_sheet(wb, ws3, 'Unit 3');

const outDir = process.argv[2] || process.cwd();
const outPath = path.join(outDir, '示例词表-30词.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Wrote', outPath);
