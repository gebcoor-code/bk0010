# Web BK-0010

A web port of **BK Emulator for Windows 3.7** — emulator of the Soviet home computers
BK-0010-01, BK-0011 and BK-0011M (Elektronika, 1985–1990). The original emulation core is
compiled to WebAssembly (wasm32-wasi) with almost no changes; Windows parts (MFC window,
DirectDraw, waveOut) are replaced by a thin web layer. Runs in any modern browser on PC,
Mac, iPad and iPhone.

## Features

- **Models**: 13 configurations of the original — BK-0010-01 (+ MSTD, + 32K RAM, + KNGMD,
  + A16M, + SMK-512), BK-0011 (+ KNGMD, + SMK-512), BK-0011M (+ KNGMD, + A16M, + SMK-512)
- **Hardware**: K1801VM1 CPU (clock 0.25x–10x, max speed), 512×256 b&w / 256×256 color screen,
  speaker, AY-3-8910, Covox, tape port 177716, joystick port 177714, floppy controllers
  KNGMD / A16M / SMK-512 (drives A:–D:), SMK-512 IDE HDD (master / slave)
- **Video**: color, black & white, green phosphor; filters (smooth, scanlines, CRT)
- **Input**: PC keyboard with the original BK key logic; on-screen BK-0010-01 keyboard,
  XT keyboard and joystick panel; NumPad joystick
- **Files**:
  - `.bin` — run through the monitor's tape routine (EMT 36), overlays from the same set
  - `.tap` / `.wav` — played as a real cassette
  - `.img` / `.bkd` / `.dsk` / `.hdi` — Boot (the model for the image is chosen) or insert into a drive
  - `.msf` — machine state (BK Emulator format 1.2), load and save
  - `.bkscript` — keyboard scripts
- **File Commander**: two panels over zip sets, mounted drives (ANDOS, FAT12 / DX-DOS,
  MKDOS, RT-11 file systems), RAM; viewer (text, hex, octal, PDP-11 disassembler)
- **Load / Save**: server list (`img/list.json`), files from the computer; state and changed
  disk images as `.zip`
- **Tools**: debugger (breakpoints, steps, registers, memory), memory map, Graph Search

## Credits

- BK Emulator for Windows — Yuriy Kalmykov (2002–2004), gid and contributors
- BkSound, FDDController — from BKBTL (LGPL-3.0)
- emu2149 (AY-3-8910) — Mitsutaka Okazaki
- Web port — ae485

## License

See [LICENSE](LICENSE). The page code is MIT; `bk.wasm` is the original emulator core in
compiled form, under its authors' terms (use in compiled form is allowed).
