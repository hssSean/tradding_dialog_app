// 透過 Supabase Management API 執行 SQL（需 .env.local 的 SUPABASE_ACCESS_TOKEN）
// 用法：node scripts/sb-query.mjs <sql 檔>　或　node scripts/sb-query.mjs -e "select 1"
// ⚠ 這是與 tradding_app 共用的正式資料庫，只能動 journal_ 開頭的物件
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const ref = env.VITE_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1]
const query = process.argv[2] === '-e' ? process.argv[3] : fs.readFileSync(process.argv[2], 'utf8')
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
console.log(res.status, (await res.text()).slice(0, 2000))
