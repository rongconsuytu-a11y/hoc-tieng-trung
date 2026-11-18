// generate-hsk3.js
// Chạy: node generate-hsk3.js
// Yêu cầu: Node.js >= 18 (đã có sẵn fetch)

const fs = require('fs');

async function generate() {
  console.log('⏳ Đang tải dữ liệu HSK 3 từ GitHub...');
  const url = 'https://raw.githubusercontent.com/koynoyno/hsk3.0-json/main/hsk3.json';
  const res = await fetch(url);
  const data = await res.json();
  
  console.log(`✅ Đã tải ${data.words.length} từ.`);
  
  const hsk3Array = data.words.map(w => ({
    hanzi: w.simplified,
    pinyin: w.pinyin,
    meaning: w.english // Nghĩa tiếng Anh. Có thể thay bằng tiếng Việt nếu muốn.
  }));
  
  const output = `// Tự động tạo bởi generate-hsk3.js\nconst HSK3_DATA = ${JSON.stringify(hsk3Array, null, 2)};\n`;
  
  fs.writeFileSync('data-hsk3.js', output, 'utf8');
  console.log('🎉 Đã tạo file data-hsk3.js với ' + hsk3Array.length + ' từ!');
  console.log('📌 Hãy thêm <script src="data-hsk3.js"></script> vào index.html (trước app.js).');
}

generate().catch(err => console.error('❌ Lỗi:', err));