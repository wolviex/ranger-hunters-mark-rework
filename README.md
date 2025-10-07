# Ranger: Favored Enemy → Hunter's Mark (Rework)

Implements a class feature version of Hunter's Mark that replaces Favored Enemy for Rangers, including Unleash Aspects.

## Requirements
- Foundry **v14**
- **dnd5e** system **v5.1.9**
- Optional: **Midi-QOL**, **libWrapper**

## Install
1. Copy this folder into your Foundry data directory:
   Data/modules/ranger-hunters-mark-rework/
   module.json
   scripts/main.js
   packs/features.db (pre-seeded compendium entry)
   packs/macros.db
   packs/effects.db
   README.md
   LICENSE

2. Enable in **Manage Modules**.
3. Open **Packs** → **Ranger Rework – Features** and drag **Favored Enemy: Hunter's Mark (Class Feature)** onto your Ranger.

## Use
- **Apply Mark**: Target up to `N` creatures (N=1 at 1st, 2 at 6th, 3 at 14th) and click **Apply Mark** on the Token HUD. Costs 1 use.
- **Bonus Damage**: On a hit against a marked target:
- With **Midi-QOL**: applied automatically.
- Core: press **Alt+M** or enable the module setting to inject a **Roll Mark Damage** button.
- **Unleash**: Use Token HUD → **Unleash** (or open the **Ranger panel** from Scene Controls) to fire:
- **Detonation**: mark die damage in 10 ft (damage type configurable).
- **Sight**: 1 min advantage on Perception/Survival.
- **Regeneration**: heal WIS mod + mark die (min 1).
- Marks end on **Unleash**, **target death**, or your **long rest**.

## Settings
- **Marked Status Icon**: path (default `icons/svg/target.svg`).
- **Mark Damage Type**: default `force`.
- **Detonation: Friendly Fire**: include/exclude allies.
- **Core Mode: Add Chat Buttons**: inject “Roll Mark Damage” button.

## Notes
- Multiple Rangers can mark the same creature; each Ranger’s bonus damage triggers only on their hits.
- No transfer of marks.
- No concentration.

## Validation & Testing
- **Pack validation**: run `node tools/validate-packs.mjs` to ensure required compendia (especially the Hunter's Mark feature) are present before packaging a release.
- **In-Foundry smoke test**: enable the module in a test world, confirm the compendium contains the feature, and use the Token HUD buttons to apply/unleash marks.
- **Automated regression ideas**:
  - Use [foundryvtt-cli](https://www.npmjs.com/package/foundryvtt-cli) in CI to spin up a headless world, enable the module, and assert via the Foundry API that the feature exists and the auto-replacement hook adds it to a sample Ranger.
  - Pair the validation script with linting (e.g., `eslint` on `scripts/main.js`) and the Foundry Package Inspector to catch manifest or compendium regressions before release.
