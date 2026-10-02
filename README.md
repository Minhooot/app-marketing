# Phone Farm Control

Bảng điều khiển web cho nhiều điện thoại Android ảo. Mỗi máy là một Android riêng (app, trình duyệt, dữ liệu riêng), tất cả được điều khiển từ một màn hình.

```
 Trình duyệt (dashboard)  ──HTTP──▶  Panel (Node.js)  ──ADB──▶  phone001 (Redroid container)
                                                         ├──▶  phone002
                                                         └──▶  ... phoneN
```

## Tính năng (MVP)

- Xem màn hình tất cả máy (dạng lưới, cập nhật mỗi 2 giây; thêm `?fps=2` vào URL để nhanh hơn)
- **Đồng bộ thao tác**: chạm hoặc vuốt trên một máy thì mọi máy đang chọn làm theo. Tọa độ được quy đổi theo độ phân giải riêng của từng máy.
- Phím Home, Back, Recents, Enter...; gõ chữ; mở link trên trình duyệt
- Mở hoặc tắt app theo package; cài APK lên nhiều máy cùng lúc
- Máy nào lỗi hay offline thì chỉ báo lỗi riêng máy đó, các máy khác vẫn chạy
- **Nhóm máy**: lưu các máy đang chọn thành nhóm (theo team, theo chiến dịch...), chọn lại cả nhóm bằng 1 click
- **Kênh MXH** (trang `/social.html`): quản lý Facebook Page, Instagram Business, TikTok qua **API chính chủ**
  - Soạn 1 bài, đăng lên nhiều kênh, đăng ngay hoặc hẹn giờ
  - Hàng đợi có trạng thái từng bài; bài lỗi bấm "Thử lại"
  - Xem lượt thích, bình luận, chia sẻ (TikTok có thêm lượt xem) của 10 bài gần nhất
  - Đọc và trả lời bình luận Facebook/Instagram ngay trên panel
  - **Lịch đăng** dạng tháng: thấy mọi bài theo ngày, màu theo trạng thái; bấm 1 ngày để đặt giờ đăng
  - **Báo cáo 7 ngày**: tổng bài, tương tác, trung bình/bài, biểu đồ tương tác theo ngày, top 3 bài
  - **Mẫu caption** có chỗ trống `{sản phẩm}`, `{giá}`...: chọn mẫu là panel hỏi từng chỗ rồi điền vào bài

## Chạy thử ngay (chế độ DEMO, không cần token)

Cần cài [Node.js](https://nodejs.org/) bản LTS. Sau đó, trong thư mục code:

```bash
npm install
npm run demo
```

Mở <http://localhost:8080/social.html>. Trang có nhãn **DEMO**: mọi lệnh gọi Facebook/Instagram/TikTok trả dữ liệu mẫu, không đăng thật lên đâu cả. Thêm kênh thì nhập ID và token bất kỳ. Dữ liệu demo lưu ở `state/db.json`, muốn làm lại từ đầu thì xóa file đó.

## Chạy nhanh

Cần một server Linux (Ubuntu 22.04+ chẳng hạn) đã cài Docker và `adb` (`apt install adb`).

```bash
# 1. Bật kernel module binder mà Redroid cần (chạy một lần sau mỗi lần khởi động lại)
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"

# 2. Tạo N máy ảo (ví dụ 5 máy) rồi khởi động
node scripts/gen-compose.js 5
docker compose up -d

# 3. Chạy panel
npm install
npm start                 # http://127.0.0.1:8080
```

Hoặc chạy `ADB_CONNECT=127.0.0.1:5555-5559 npm start` để panel tự kết nối mọi máy (và tự nối lại khi container khởi động lại). Không dùng biến này thì mở dashboard, dán `127.0.0.1:5555 ... 127.0.0.1:5559` vào ô "Kết nối máy ảo" rồi bấm **Kết nối**.

### Chạy 20 máy

```bash
node scripts/gen-compose.js 20
docker compose up -d
ADB_CONNECT=127.0.0.1:5555-5574 npm start
```

Mỗi máy Redroid cần khoảng 2–4 GB RAM, nên 20 máy cần tầm **40–80 GB RAM** cộng thêm phần cho hệ điều hành. Đừng đoán, hãy đo:

```bash
docker compose up -d phone001 phone002 phone003 phone004 phone005
# mở app thật trên 5 máy (Chrome, app hay dùng...), rồi:
node scripts/capacity-check.js
```

Script đo RAM/CPU thực tế của các máy đang chạy, chừa 20% tài nguyên dự phòng (đổi bằng `--headroom 0.3`), rồi báo server chứa thêm được bao nhiêu máy và đang bị giới hạn bởi RAM hay CPU.

Panel cũng điều khiển được emulator Android Studio hoặc điện thoại thật cắm USB, miễn là `adb devices` thấy máy đó.

### Có CH Play + Chrome trên từng máy

Image Redroid gốc **không có** Google Play. Dùng [redroid-script](https://github.com/ayasa520/redroid-script) để build image có MindTheGapps (cờ `-mtg`), rồi trỏ compose sang image đó:

```bash
git clone https://github.com/ayasa520/redroid-script && cd redroid-script
python3 redroid.py -a 12.0.0_64only -mtg          # in ra tên image vừa build
cd - && node scripts/gen-compose.js 5 <tên-image-vừa-build>
docker compose up -d
```

Máy chạy GApps tự build là máy **chưa được Google chứng nhận**, nên CH Play sẽ không đăng nhập được cho tới khi đăng ký:

1. Chọn các máy trên dashboard, bấm **Lấy GSF ID**
2. Dán từng ID vào <https://www.google.com/android/uncertified> (đăng nhập bằng tài khoản Google của anh)
3. Đợi vài phút, khởi động lại máy rồi mở CH Play và đăng nhập
4. Cài Chrome từ CH Play, hoặc bấm **Cài APK** cho nhiều máy cùng lúc

Mỗi máy có volume `data/phoneXXX` riêng, nên tài khoản và app đã đăng nhập vẫn còn sau khi khởi động lại.

### Truy cập từ xa

Mặc định panel chỉ nghe ở `127.0.0.1`. Muốn mở ra ngoài thì **bắt buộc** đặt token:

```bash
HOST=0.0.0.0 PANEL_TOKEN=chuoi-bi-mat-dai npm start
# mở: http://<ip-server>:8080/?token=chuoi-bi-mat-dai
```

Nên đặt panel sau HTTPS (Nginx/Caddy) hoặc VPN. Cổng ADB 5555+ của các máy ảo chỉ bind vào `127.0.0.1`, **đừng** mở các cổng này ra internet.

## Kết nối kênh MXH

Token lấy từ app của anh trên [Meta for Developers](https://developers.facebook.com/) và [TikTok for Developers](https://developers.tiktok.com/):

| Kênh | Cần nhập | Quyền (permission/scope) |
|---|---|---|
| Facebook Page | Page ID + Page access token | `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement` |
| Instagram | IG Business Account ID + Page access token của Page gắn với IG | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments` |
| TikTok | User access token (Login Kit) | `video.publish`, `video.list` |

Lưu ý:
- Bài hẹn giờ do **panel tự đăng** khi tới giờ (kiểm tra mỗi 30 giây), nên server phải đang chạy. Nếu server tắt đúng lúc đang đăng, bài sẽ hiện "Lỗi" thay vì tự đăng lại, để tránh đăng trùng. Anh kiểm tra kênh rồi bấm "Thử lại".
- Instagram bắt buộc phải có ảnh. Ảnh và video phải là URL công khai mà Meta/TikTok tải về được.
- TikTok: video phải nằm trên domain đã xác minh trong TikTok for Developers. App chưa qua audit chỉ đăng được ở chế độ riêng tư (`SELF_ONLY`). API công khai của TikTok không cho đọc hay trả lời bình luận.
- Token được lưu trong `state/db.json` (quyền file 600, đã nằm trong `.gitignore`). Không commit hay chia sẻ file này.
- Page token lấy từ user token dài hạn thì không hết hạn; TikTok access token hết hạn sau khoảng 24 giờ, cần làm mới.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8080` | Cổng web |
| `HOST` | `127.0.0.1` | Interface lắng nghe |
| `PANEL_TOKEN` | (trống) | Token bảo vệ API, bắt buộc khi `HOST` không phải localhost |
| `ADB_PATH` | `adb` | Đường dẫn tới adb |
| `ADB_TIMEOUT_MS` | `30000` | Timeout mỗi lệnh adb |
| `ADB_CONNECT` | (trống) | Tự kết nối các máy khi khởi động và mỗi 60 giây, ví dụ `127.0.0.1:5555-5574` |
| `DB_FILE` | `state/db.json` | File lưu nhóm, kênh, hàng đợi bài |
| `META_GRAPH_VERSION` | `v24.0` | Phiên bản Graph API của Meta |

## Giới hạn đã biết và hướng nâng cấp

- **Gõ tiếng Việt có dấu / emoji**: tải APK [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard/releases) rồi bấm **Cài APK** cho các máy. Khi gõ chữ có dấu, panel tự bật ADBKeyboard làm bàn phím mặc định (bàn phím ảo trên màn hình sẽ ẩn đi; muốn dùng lại Gboard thì đổi trong Cài đặt). Chữ không dấu vẫn gõ bình thường, không cần ADBKeyboard.
- **Màn hình** lấy bằng ảnh chụp định kỳ (`screencap`). Lưới chỉ tải máy đang hiện trên màn hình, và chỉ xin khung mới khi khung cũ đã về, nên 20 máy không làm nghẽn server. Bấm 🔍 để phóng to 1 máy (khoảng 3 khung/giây, chạm/vuốt trực tiếp được). Muốn mượt kiểu video thì nâng lên scrcpy/ws-scrcpy.
- **Google Play**: xem mục "Có CH Play + Chrome" ở trên.
- **Sức chứa**: dùng `scripts/capacity-check.js` (xem mục Chạy 20 máy).

## Test

```bash
npm test   # dùng test/fake-adb.js nên không cần máy thật
```
