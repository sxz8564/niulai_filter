# Not getting locked out of your own characters

The goal here is defensive: never end up unable to use 牛来, 豹拉 or Critter Cam
because somebody else registered them first. Not licensing, not selling rights,
not stopping fans. That narrows what is worth doing considerably.

Preparation notes, not legal advice.

## The short version

One of the three things people worry about is a real risk. The other two mostly
are not.

| Worry | Real? | What to do |
| --- | --- | --- |
| Someone registers **the names** as a trademark in China and blocks you | **Yes. This is the one.** First to file wins, squatting is routine, and undoing it costs far more than filing | Register the names you actually use, in the classes you actually operate |
| Someone registers **the character pictures** as their trademark | Possible | Your earlier copyright beats it — but only if you can prove it cheaply. A 版权登记 certificate is what makes that cheap |
| Someone registers **copyright** in your characters and takes them from you | Largely not | Copyright is yours from the moment you made them. A stranger's filing does not transfer it, and your dated evidence wins |

## Why the copyright worry is smaller than it feels

Copyright exists from creation, automatically, in every Berne country. There is
no queue to win. Someone who files a registration over your character has not
acquired anything — Chinese 作品登记 is a filing, not an examination, so a
registration certificate is evidence, not proof, and it loses to better evidence.

Better evidence is what you already have, and more of it than most people ever
assemble:

- Every character's first appearance is a **dated commit**, and the whole
  process is in the history — rigging, re-rigging, a beak that had to stop
  hinging like a mammal jaw. That is very hard to fabricate after the fact.
- The **Chrome Web Store listing** is a public, dated, third-party record of
  first use.
- `docs/ip/` holds a five-view sheet per character, each printed with the
  **SHA-256** of the model it was rendered from and that file's first commit
  date, so a sheet cannot drift from the file it claims to depict.

So registering copyright is worth doing, but not because you would otherwise
lose the right. It is worth doing because it converts an argument into a
document, and because of the trademark point below.

## Why the trademark worry is real

China is **first to file**. Whoever registers a mark owns it, regardless of who
invented it. There is a whole industry registering names spotted in app stores
and then selling them back. If someone registers 牛来 in class 9 before you do,
they can demand you stop using it on your own software.

There is a narrow prior-use defence — Chinese Trademark Law article 59(3) lets
you carry on using a mark you used to some influence before their filing — but
it is a *defence*, not ownership. It keeps you where you are, at the scale you
were already at, and lets them keep the registration. It is worth much less
than having filed.

**A public Chinese-language store listing is exactly what squatters watch.**
Filing before you push the Chinese listing widely is the single highest-value
thing on this page.

## Correcting something I said earlier

I previously flagged the MIT licence covering the artwork as the first thing to
fix. For your goal, that was wrong-footed. MIT lets other people copy the
characters; it does not take away your right to use them, which is what you
actually care about. It also does not hand anyone a trademark.

If it ever bothers you that a copycat app could ship your characters lawfully,
the fix is a carve-out — code MIT, artwork and names reserved — and I can write
it in a few minutes. But it is a preference, not a defence, and nothing on this
page waits for it.

One genuinely useful side effect of publishing under MIT on a public dated
repository: it is **defensive publication**. It makes your authorship and its
date matter-of-public-record, which is helpful ammunition against anyone
claiming they got there first.

## What to actually do

Ordered by how much protection each buys per unit of money and time.

### 1. Timestamp the repository — cheap, do it now

A Git timestamp is only as trustworthy as whoever can rewrite it. Putting the
current tree through a timestamping service fixes the date to something you do
not control. In China the 联合信任时间戳 service (tsa.cn) is the one courts
routinely accept. Small money, no lawyer, strongest evidence-per-yuan on this
page.

### 2. Register the trademarks you would actually be hurt by losing

Not all six names. Defensive means covering what would stop you working:

- **Critter Cam** — the product name. Classes **9** (downloadable software) and
  **42** (software as a service). This is the one that matters most; it is what
  the store listing, the icon and the domain all point at.
- **牛来** and **豹拉** — coined and distinctive, so they will register, and
  they are the two most likely to be picked up by someone else.
- **牛妈妈**, **牛爸爸**, **小鸟** — these mean "cow mother", "cow father" and
  "little bird". An examiner may refuse them as descriptive, and for the same
  reason nobody else can easily monopolise them against you. Low risk, low
  priority. If you want them covered, file them as **figurative marks**, the
  artwork together with the name.

Search first at sbj.cnipa.gov.cn. As a foreign applicant you will generally
need an agent; the thing they earn their fee on is choosing subclasses
(类似商品和服务区分表), because Chinese protection is effectively per subclass.

Official fees are modest — a few hundred yuan per class for an electronic
filing — and agent fees are the larger part. Check current rates.

### 3. Register the character designs as 美术作品

Through the Copyright Protection Centre (ccopyright.com.cn). Two defensive
reasons, both concrete:

- **It is the counter to a figurative trademark squat.** Prior copyright is a
  prior right under article 32 of the Trademark Law, so a design certificate
  dated before their filing is the instrument for opposing or invalidating a
  mark someone builds out of your character.
- **Platforms want a document.** Store and marketplace takedown processes are
  built around certificates, not narratives.

The sheets in `docs/ip/` are made to be the work sample. Attach the `.glb`
where the office accepts a file.

### 4. United States, only if you care about US enforcement

Registration at copyright.gov is required before you can sue over a US work,
and statutory damages need registration before the infringement. Disclaim the
machine-generated portions and claim the human contribution — see below.

## One thing to check before filing anything

`THIRD_PARTY_NOTICES.md` records that the meshes were generated with Meshy AI
from your designs, then cropped, retextured and rigged by the tools here. Two
questions follow, and both are worth answering before you pay a fee:

- **Did the generator's terms pass ownership to you?** Check the plan that
  produced each model. If output ownership did not transfer, a registration in
  your name is built on sand.
- **How much of the result is human work?** The US Copyright Office requires
  AI-generated portions to be disclaimed and protects only the human
  contribution. Chinese courts have been more willing to find copyright in
  AI-assisted images where the human input was substantial.

Your answer to the second is stronger than most: an original design came first,
and the rigging, retexturing and expression work is recorded commit by commit.
Keep that history. It is the evidence that the human contribution was real.

## Inventory

`node tools/make-character-sheets.mjs` regenerates the sheets and
`docs/ip/inventory.json`.

| Character | Chinese | Sheet |
| --- | --- | --- |
| Niulai | 牛来 | `docs/ip/niulai.png` |
| Baola | 豹拉 | `docs/ip/baola.png` |
| Wolfwolf | 狼狼 | `docs/ip/wolfwolf.png` |
| NiuMama | 牛妈妈 | `docs/ip/niumama.png` |
| NiuBaba | 牛爸爸 | `docs/ip/niubaba.png` |
| XiaoNiao | 小鸟 | `docs/ip/xiaoniao.png` |

Scene paintings are separate works and can be registered as a batch; they are
in `models/backgrounds/`.
