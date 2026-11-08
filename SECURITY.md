# Security

Songline is a static web app and a small local server meant for your own
devices. Its design keeps your data local: songs and settings stay in the
browser, and microphone audio is analysed on the device and never sent anywhere.

If you find a security problem, such as a way for a web page or another device
on the network to read files outside the app and song folders, please **don't
open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/mbhewitt/songline/security/advisories/new)
instead. We'll respond as soon as we can.

Things to know when running the server:

- By default it only listens on `127.0.0.1` (this computer).
- `--host 0.0.0.0` makes your song folders readable by anyone who can reach the
  computer. Use it only on networks you trust, and don't expose it to the
  internet.
- `tools/make_cert.sh` creates a private certificate authority. Keep
  `certs/ca.key` secret: anyone who has it can create certificates that devices
  trusting your `ca.crt` will accept.
