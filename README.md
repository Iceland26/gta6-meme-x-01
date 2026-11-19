# gta6-meme-x-01

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/Iceland26/gta6-meme-x-01/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/Iceland26/gta6-meme-x-01/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

An entry for the make.fun bounty "Post a GTA 6 meme on X". The meme: you waited 13 years to visit Vice City — the make.fun ghost bought the beach house first, with bounty money. It is standing in the sand next to its SOLD sign, house keys in one hand, its magenta star coin held high in the other, under a Vice City sunset.

`main.ts` (Node 22, standard library only, no network) does two things: it copies `POST.json` — the address of the X post that is the entry — to the output directory for the make.fun gate, and it renders the meme picture itself. The 1024x1024 PNG is drawn by a small rasterizer and PNG encoder written in the same file (a hand-drawn 5x9 grid font for the captions, a fixed-seed generator for the lit windows and sea glitter), so every run writes byte-identical output: `out/POST.json` and `out/meme.png`.

`caption.txt` holds the X post's text exactly as posted. The repository was created after the bounty opened; the kit's anchor commit and MIT license come first in its history.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```
