# 🐴 Cờ Cá Ngựa Online

Game cờ cá ngựa nhiều người chơi trên web: tạo phòng, gửi link cho bạn bè, chơi realtime.
Server chỉ dùng Node.js thuần, **không cần cài thư viện nào**.

## Chạy trên máy
```bash
node server.js
# mở http://localhost:3000
```
Chạy test: `node test.js`

## Đưa lên Render (miễn phí)
1. Tạo repo mới trên GitHub (ví dụ `co-ca-ngua`), tải toàn bộ file trong thư mục này lên.
2. Vào https://dashboard.render.com → **New → Blueprint** → chọn repo vừa tạo → **Apply**.
   (File `render.yaml` đã cấu hình sẵn: gói Free, máy chủ Singapore.)
   - Hoặc **New → Web Service** → chọn repo → Runtime: Node, Build: `npm install`, Start: `npm start`, Region: Singapore, Instance: Free.
3. Đợi 1–2 phút, Render cấp link dạng `https://co-ca-ngua.onrender.com`.

Lưu ý gói miễn phí: server ngủ sau 15 phút không ai truy cập, người đầu tiên vào sẽ chờ ~30–60 giây.
Khi server ngủ/khởi động lại, các phòng đang chơi sẽ mất (dữ liệu lưu trong RAM).

## Luật chơi
- 2–4 người (có thể thêm máy). Mỗi người 4 quân.
- Gieo **6** mới được ra quân.
- Được gieo thêm khi: gieo 6, đá được quân đối phương, hoặc đưa quân về đích.
- Gieo 6 ba lần liên tiếp → mất lượt.
- Đi vào ô có quân đối phương → đá quân đó về nhà (trừ ô có ★ là ô an toàn).
- Về đích phải gieo đúng số. Ai đưa đủ 4 quân về đích trước thì thắng.
- Mỗi lượt 30 giây; hết giờ hoặc mất kết nối → máy tự đi thay.

Muốn đổi luật: sửa trong `game.js` (các hằng số ở đầu file và hàm `legalMoves`, `move`).

## Cấu trúc
- `game.js` — luật chơi (chạy trên server)
- `server.js` — server HTTP, phòng chơi, realtime (Server-Sent Events)
- `public/index.html` — giao diện (bàn cờ SVG, xúc xắc, chat)
- `test.js` — kiểm thử
