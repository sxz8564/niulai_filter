# US registration: not getting locked out of your own characters

The goal is defensive — never end up unable to use the characters or the name
because someone else got there first. Registration is in the United States.

Preparation notes, not legal advice. The one item at the top needs a real
trademark attorney before you spend money on anything else.

## The problem is the opposite of the one you were worried about

**CRITTERCAM is a live US trademark, registered in International Class 9, owned
by the National Geographic Society.**

- Reg. 3147049 (filed 1999, registered 2006, renewed) — Class 9, for an
  integrated video camcorder and imaging system for affixation to animals.
- Reg. 2354895 — services around animal-behaviour research using those systems.

Class 9 is exactly where downloadable software is registered, and the goods are
cameras. "Critter Cam" against "CRITTERCAM" is a space. That means two things,
and the second is the one that matters for a defensive goal:

1. **A US application would probably be refused** under §2(d), likelihood of
   confusion, with that registration cited against it.
2. **You are the later user of an established mark, not the target of a
   squatter.** National Geographic has used the name since the late 1980s and
   is an active enforcer. The realistic risk to your ability to keep working is
   a cease-and-desist about the product name — not someone stealing 牛来.

This is worth an attorney's opinion before anything else, because the answer
determines whether you are registering a name or changing one. Arguments exist
on your side — different goods, different buyers, no one shopping for a browser
extension thinks they are getting a whale-mounted camera — but they are
arguments, and they cost money to make.

Two practical notes. The 2006 registration's ten-year renewal window falls
around now, so an attorney should pull the current status from TSDR rather than
trusting a 2016 snapshot. And if a rename is on the table, doing it **before**
building more brand equity is far cheaper than after — the extension is new,
the store listing is young, and nothing is lost yet but a name.

The character names look clearer. A knock-out search found **BAOLA** registered
(Reg. 5995999, 2020) for kitchen and household goods, which is a different class
and unrelated goods, and a pending **NIULAA** in a different spelling. Neither
looks like an obstacle in Class 9. This is a preliminary search, not clearance.

## The US does not work the way you feared

China is first to file, which is what makes squatting there so effective. **The
US is first to use.** Trademark rights arise from actual use in commerce, and a
later filer does not simply take them from an earlier user. You have been using
these names publicly, with dated evidence, since August 2026.

So the nightmare — a stranger registers 牛来 and forbids you from using it — is
much harder to pull off here. What registration adds is worth having:
nationwide rights instead of rights limited to where you actually trade, a
presumption of validity, and the ability to sue in federal court. But it is an
upgrade, not a rescue.

Copyright is the same story, more so. It exists from the moment you create the
work, and no one else's filing takes it from you.

## Do this first: register the copyright, and do it before late November

This is cheap, needs no attorney, and there is a deadline you are currently
inside.

Two provisions decide the timing:

- **17 U.S.C. §411(a)** — you cannot file an infringement suit over a US work
  until it is registered. Not a deadline, but it means an unregistered work is
  one you cannot enforce quickly.
- **17 U.S.C. §412** — statutory damages and attorney's fees are unavailable
  for infringement that began before registration, **unless registration
  happens within three months of first publication.**

That second one is a window, and yours is open. The characters were first
published around **29–30 August 2026**, so the three-month window closes at the
**end of November 2026**. Register inside it and you are covered for
infringements that occur in the meantime; miss it and you can still register,
but you lose statutory damages and fees for anything that started first. Since
statutory damages are often the only thing that makes a small-scale
infringement worth pursuing at all, this is the difference between a right you
can enforce and one you can only assert.

- Where: eCO at copyright.gov.
- Cost: on the order of $45–65 per application; check the current schedule.
- What to file: the six character designs as visual art. Works first published
  together in the same release can go on one application as a **unit of
  publication**, which is the cheap route — confirm your facts fit it.
- Work sample: the sheets in `docs/ip/`. Each carries the source filename, the
  SHA-256 of the model it was rendered from, and that file's first commit date.

## The AI disclosure, which you must get right

`THIRD_PARTY_NOTICES.md` records that the meshes were generated with Meshy AI
from your designs, then cropped, retextured and rigged by the tools here. The
Copyright Office requires that machine-generated material be **disclaimed**,
and registers only the human contribution. An application that quietly claims
the whole thing risks being refused, or worse, cancelled later for a
misstatement — which would be a self-inflicted version of exactly the outcome
you are trying to avoid.

So claim what is actually yours, explicitly:

- The **original character designs** that went in as input.
- The **selection, modification and arrangement** of the output: cropping,
  retexturing, and the rigging that gives each character its expressions.
- The **morph-target work** — a jaw that opens onto a modelled interior, a beak
  that hinges at the beak rather than at an invented mammal jaw, eyes that
  blink one at a time.

Then disclaim the machine-generated mesh itself.

Two things support this better than most applicants can manage. First, check
whether the Meshy plan you used passes output ownership to you — if it does not,
say so and adjust the claim. Second, the commit history records the human work
step by step, including the rigs that were wrong and had to be redone. That is
unusually good evidence that a person did something.

## Then the trademark, once the name question is settled

Assuming you keep or change the name, the filing looks like this:

- **Class 9** for the downloadable extension. **Class 42** if you offer a hosted
  service later; the extension alone is Class 9.
- **Basis §1(a), use in commerce** — the Chrome Web Store listing is a plausible
  specimen, provided the screenshot shows the mark *and* the download point on
  the same page.
- **Fees**: base $350 per class since the January 2025 restructuring, plus $200
  per class if you write your own description instead of picking from the ID
  Manual, plus other surcharges. Use the ID Manual.
- **If you are not domiciled in the United States**, a US-licensed attorney is
  mandatory, not optional.

For the character names: file the distinctive ones. 牛妈妈, 牛爸爸 and 小鸟 mean
"cow mother", "cow father" and "little bird" — descriptive in translation, which
cuts both ways: harder for you to register, and equally hard for anyone else to
monopolise against you. Low risk, low priority.

## Evidence you already have

- **Dated authorship.** Each character's first appearance is a timestamped
  commit, and the design process is in the history.
- **File identity.** Every sheet in `docs/ip/` carries the SHA-256 of the model
  it depicts, so a picture cannot drift from the file it claims to show.
- **Publication.** The Chrome Web Store listing is a third-party dated record
  of first use.

One weakness: a Git timestamp is only as good as the person who can rewrite it.
A timestamping service fixes the dates to something outside your control, and
costs very little.

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

Scene paintings are separate works, in `models/backgrounds/`.

## Order of work

1. Get an attorney's read on Critter Cam against National Geographic's
   CRITTERCAM in Class 9. Everything about the name waits on this.
2. Register the six character designs with the Copyright Office, with the AI
   disclaimer, **before the end of November 2026**.
3. Timestamp the repository.
4. Confirm the Meshy terms passed output ownership to you.
5. File the trademark — under whatever name survives step 1.
