'use strict';
// Tabla parcial de fabricantes (prefijo MAC → marca). El resto se resuelve online y queda en caché local.
const G = {
  'Apple': '00:03:93 00:0a:27 00:0a:95 00:11:24 00:14:51 00:16:cb 00:17:f2 00:19:e3 00:1b:63 00:1c:b3 00:1e:c2 00:1f:5b 00:1f:f3 00:21:e9 00:23:12 00:23:32 00:23:6c 00:24:36 00:25:00 00:25:4b 00:26:08 00:26:4a 00:26:b0 00:26:bb 3c:07:54 3c:d0:f8 40:6c:8f 44:2a:60 5c:59:48 60:03:08 68:a8:6d 70:56:81 78:31:c1 7c:6d:62 88:63:df 8c:85:90 98:01:a7 a4:5e:60 ac:bc:32 b8:78:2e bc:92:6b d0:03:4b d8:30:62 e0:b9:ba f0:18:98 f4:5c:89 f8:1e:df',
  'Samsung': '00:00:f0 00:12:47 00:15:99 00:16:32 00:17:d5 00:1a:8a 00:21:19 00:23:39 00:24:54 08:08:c2 38:aa:3c 5c:0a:5b 84:25:db 8c:77:12 e8:50:8b f0:25:b7',
  'TP-Link': '50:c7:bf 14:cc:20 98:da:c4 c0:06:c3 10:fe:ed 18:d6:c7 30:b5:c2 54:c8:0f 60:e3:27 64:70:02 a0:f3:c1 ec:08:6b f4:f2:6d 74:da:88 b0:95:75 1c:3b:f3',
  'Netgear': '00:09:5b 00:0f:b5 00:14:6c 00:1b:2f 00:1e:2a 20:4e:7f a0:21:b7 c0:3f:0e 9c:3d:cf 2c:30:33',
  'D-Link': '00:05:5d 00:0d:88 00:11:95 00:13:46 00:15:e9 00:17:9a 00:19:5b 00:1b:11 00:1c:f0 00:1e:58 14:d6:4d 1c:7e:e5 28:10:7b 90:94:e4',
  'Huawei': '00:e0:fc 00:25:9e 00:46:4b 00:66:4b 04:c0:6f 20:f3:a3 28:6e:d4 4c:54:99 78:f5:57 80:fb:06 9c:28:ef e8:cd:2d',
  'Xiaomi': '28:6c:07 34:80:b3 64:09:80 78:11:dc f8:a4:5f 50:8f:4c 98:fa:e3 64:b4:73 74:23:44 ac:c1:ee 9c:99:a0',
  'Intel': '00:1b:21 00:13:e8 00:15:00 00:1e:64 3c:97:0e 7c:5c:f8 a4:4e:31 b4:6b:fc',
  'Ubiquiti': '00:15:6d 00:27:22 24:a4:3c 44:d9:e7 68:72:51 74:83:c2 78:8a:20 80:2a:a8 b4:fb:e4 dc:9f:db f0:9f:c2 fc:ec:da',
  'MikroTik': '00:0c:42 4c:5e:0c 64:d1:54 6c:3b:6b b8:69:f4 d4:ca:6d e4:8d:8c',
  'HP': '00:01:e6 00:02:a5 00:0b:cd 00:0d:9d 00:0e:7f 00:11:0a 00:12:79 00:14:38 00:15:60 00:17:08 00:18:fe 00:1a:4b 00:1b:78 00:1c:c4 3c:d9:2b 94:57:a5 9c:b6:54 a0:d3:c1',
  'Canon': '00:00:85 00:1e:8f 18:0c:ac',
  'Epson': '00:00:48 00:26:ab 38:9d:92 ac:18:26',
  'Brother': '00:80:77 00:1b:a9 30:05:5c',
  'LG Electronics': '00:1c:62 00:1e:75 00:22:a9 10:68:3f 34:4d:f7 a8:23:fe c4:36:6c 58:a2:b5 78:5d:c8 cc:2d:8c',
  'Raspberry Pi': 'b8:27:eb dc:a6:32 e4:5f:01 d8:3a:dd 2c:cf:67 28:cd:c1',
  'Espressif (IoT/ESP)': '24:0a:c4 30:ae:a4 3c:71:bf 84:0d:8e a4:cf:12 24:6f:28 5c:cf:7f 18:fe:34 60:01:94 68:c6:3a ec:fa:bc cc:50:e3 b4:e6:2d ac:67:b2 8c:aa:b5 7c:9e:bd',
  'Google / Nest': '3c:5a:b4 f4:f5:d8 54:60:09 1c:f2:9a a4:77:33 48:d6:d5 d8:6c:63',
  'Amazon': '44:65:0d 74:c2:46 fc:65:de 68:54:fd f0:27:2d 84:d6:d0 40:b4:cd 00:fc:8b',
  'Philips Hue (Signify)': '00:17:88',
  'Sonos': '00:0e:58 5c:aa:fd 78:28:ca b8:e9:37 94:9f:3e',
  'Nintendo': '00:09:bf 00:1a:e9 98:b6:e9 7c:bb:8a',
  'Sony PlayStation': '00:04:1f 00:19:c5 00:1d:0d fc:0f:e6',
  'Roku': '00:0d:4b b0:a7:37 ac:3a:7a cc:6d:a0 d8:31:34',
  'VMware': '00:0c:29 00:50:56 00:05:69 00:1c:14',
  'VirtualBox': '08:00:27',
  'Microsoft Hyper-V': '00:15:5d',
  'QEMU/KVM': '52:54:00',
};
const T = {};
for (const [v, list] of Object.entries(G)) for (const p of list.split(' ')) T[p] = v;
const lookup = mac => T[String(mac || '').slice(0, 8).toLowerCase()] || '';
// Bit "administrado localmente": MAC aleatoria/privada (iOS, Android, Windows con MAC aleatoria)
const isPrivate = mac => !!mac && (parseInt(String(mac).slice(0, 2), 16) & 2) !== 0;
module.exports = { lookup, isPrivate };
