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

Mở dashboard, dán `127.0.0.1:5555 ... 127.0.0.1:5559` vào ô "Kết nối máy ảo" rồi bấm **Kết nối**.

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

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8080` | Cổng web |
| `HOST` | `127.0.0.1` | Interface lắng nghe |
| `PANEL_TOKEN` | (trống) | Token bảo vệ API, bắt buộc khi `HOST` không phải localhost |
| `ADB_PATH` | `adb` | Đường dẫn tới adb |
| `ADB_TIMEOUT_MS` | `30000` | Timeout mỗi lệnh adb |

## Giới hạn đã biết và hướng nâng cấp

- **Gõ tiếng Việt có dấu**: `adb input text` chỉ nhận ASCII. Muốn gõ có dấu thì cài [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) lên máy rồi gửi broadcast.
- **Màn hình** hiện lấy bằng ảnh chụp định kỳ (`screencap`). Muốn mượt kiểu xem video thì nâng lên stream bằng scrcpy hoặc ws-scrcpy.
- **Google Play**: xem mục "Có CH Play + Chrome" ở trên.
- **Sức chứa**: RAM và CPU mỗi máy tùy app chạy bên trong; nên test với vài máy trước rồi mới nhân lên.
- Kịch bản tự động (macro, lên lịch), quản lý proxy theo từng máy, nhóm máy: để cho các phiên bản sau.

## Test

```bash
npm test   # dùng test/fake-adb.js nên không cần máy thật
```
