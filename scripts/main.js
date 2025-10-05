// scripts/main.js
// Ranger: Favored Enemy → Hunter's Mark (Rework)
// Foundry v13+ compatible (tested with v13 b350); dnd5e 5.x
// Author: Joe Manifold
/* eslint no-undef:0 */

/**
 * Features:
 * - Class Feature item replacing Favored Enemy with a scalable mark + Unleash Aspects.
 * - Uses/day = PB + WIS; targets per use = 1 (lv1), 2 (lv6), 3 (lv14); no transfer.
 * - Bonus damage per hit vs. marked targets: 1d6@1,1d8@5,1d10@9,1d12@13,2d8@17; damage type configurable (default: force).
 * - Marks end on Unleash, target death, or your long rest.
 * - Unleash Aspects: Detonation (AoE dmg), Sight (skill advantage 1 min), Regeneration (heal self).
 * - Token HUD buttons (Apply Mark / Unleash) + Scene Controls panel.
 * - Midi-QOL integration for automatic damage bonus; core fallback (hotkey/chat button).
 * - Compendium packs are ensured/created on load; feature is seeded automatically.
 * - Option to auto-replace the original "Favored Enemy" on all Rangers and block future adds.
 */

const MODULE_ID = "ranger-hunters-mark-rework";
const FEATURE_NAME = "Favored Enemy: Hunter's Mark (Class Feature)";

const SETTINGS = {
  icon: "iconPath",
  damageType: "damageType",
  detFF: "detonationFriendlyFire",
  coreButtons: "coreAttackButtons",
  autoReplace: "autoReplaceFavoredEnemy"
};

const DEFAULTS = {
  icon: "icons/svg/target.svg",
  damageType: "force",
  detonationFriendlyFire: true,
  coreAttackButtons: true,
  autoReplace: true
};

/* ------------------------- Utilities ------------------------- */
const F = {
  clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); },
  levelToMarkDie(level) {
    if (level >= 17) return "2d8";
    if (level >= 13) return "1d12";
    if (level >= 9)  return "1d10";
    if (level >= 5)  return "1d8";
    return "1d6";
  },
  markCapacity(level) {
    if (level >= 14) return 3;
    if (level >= 6)  return 2;
    return 1;
  },
  actorPB(actor) { return actor?.system?.attributes?.prof ?? 2; },
  actorWISmod(actor) { return actor?.system?.abilities?.wis?.mod ?? 0; },
  usesPerDay(actor) { return Math.max(0, F.actorPB(actor) + F.actorWISmod(actor)); },
  isRanger(actor) {
    const classes = actor?.system?.classes ?? {};
    return Object.values(classes).some(c => (c?.identifier ?? c?.name ?? "").toLowerCase().includes("ranger"));
  },
  rangerLevel(actor) {
    const classes = actor?.system?.classes ?? {};
    const ranger = Object.values(classes).find(c => (c?.identifier ?? c?.name ?? "").toLowerCase().includes("ranger"));
    return Number(ranger?.levels ?? 0);
  },
  getIcon() { return game.settings.get(MODULE_ID, SETTINGS.icon); },
  getDmgType() { return game.settings.get(MODULE_ID, SETTINGS.damageType); },
  ffOn() { return game.settings.get(MODULE_ID, SETTINGS.detFF); },
  coreBtns() { return game.settings.get(MODULE_ID, SETTINGS.coreButtons); },
  autoReplace() { return game.settings.get(MODULE_ID, SETTINGS.autoReplace); },

  // flags on TARGET: flags.ranger-hunters-mark-rework.marks[<rangerUuid>]
  getMarkOnTargetByRanger(targetActor, rangerUuid) {
    const marks = targetActor?.getFlag(MODULE_ID, "marks") || {};
    return marks?.[rangerUuid] ?? null;
  },
  async setMarkOnTargetByRanger(targetActor, rangerUuid, payload) {
    const marks = foundry.utils.duplicate(targetActor.getFlag(MODULE_ID, "marks") || {});
    marks[rangerUuid] = payload;
    await targetActor.setFlag(MODULE_ID, "marks", marks);
  },
  async deleteMarkOnTargetByRanger(targetActor, rangerUuid) {
    const marks = foundry.utils.duplicate(targetActor.getFlag(MODULE_ID, "marks") || {});
    delete marks[rangerUuid];
    await targetActor.setFlag(MODULE_ID, "marks", marks);
  },
  countActiveMarksForRanger(ranger) {
    const tokens = canvas?.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? [];
    const ruuid = ranger.uuid;
    return tokens.reduce((n, a) => n + (F.getMarkOnTargetByRanger(a, ruuid) ? 1 : 0), 0);
  },
  async chat(content, speaker) { return ChatMessage.create({ content, speaker }); },
  async warn(html) { ui.notifications.warn(html); },
  async info(html) { ui.notifications.info(html); },
  async error(html) { ui.notifications.error(html); }
};

/* ------------------------- Settings ------------------------- */
function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.icon, {
    scope: "world", config: true, type: String, default: DEFAULTS.icon,
    name: "Marked Status Icon", hint: "Path to the icon shown on marked targets."
  });
  game.settings.register(MODULE_ID, SETTINGS.damageType, {
    scope: "world", config: true, type: String, default: DEFAULTS.damageType,
    name: "Mark Damage Type", hint: "Damage type for bonus damage and Detonation.",
    choices: {
      "force": "Force", "necrotic": "Necrotic", "radiant": "Radiant",
      "psychic": "Psychic", "thunder": "Thunder"
    }
  });
  game.settings.register(MODULE_ID, SETTINGS.detFF, {
    scope: "world", config: true, type: Boolean, default: DEFAULTS.detonationFriendlyFire,
    name: "Detonation: Friendly Fire", hint: "If on, Detonation hits all creatures in range. If off, excludes allies."
  });
  game.settings.register(MODULE_ID, SETTINGS.coreButtons, {
    scope: "world", config: true, type: Boolean, default: DEFAULTS.coreButtons,
    name: "Core Mode: Add Chat Buttons", hint: "Insert a 'Roll Mark Damage' button into attack chat messages (no Midi-QOL)."
  });
  game.settings.register(MODULE_ID, SETTINGS.autoReplace, {
    scope: "world", config: true, type: Boolean, default: DEFAULTS.autoReplace,
    name: "Auto-Replace Favored Enemy",
    hint: "On world load, replace the original Favored Enemy feature on all Rangers with the new class feature. Also swaps future adds."
  });
}

/* --------------------- Packs & Seeding ----------------------- */
async function ensurePack({ name, label, type, system }) {
  const key = `${MODULE_ID}.${name}`;
  let pack = game.packs.get(key);
  if (pack) return pack;

  const metadata = {
    label, name, path: `packs/${name}.db`,
    type, system, package: MODULE_ID, private: false
  };

  if (CompendiumCollection?.createCompendium) {
    pack = await CompendiumCollection.createCompendium(metadata);
    return game.packs.get(key);
  } else {
    ui.notifications.error("This Foundry version cannot create compendiums programmatically.");
    return null;
  }
}

function buildFeatureItemData() {
  return {
    name: FEATURE_NAME,
    type: "feat",
    img: "icons/skills/targeting/target-strike-triple-blue.webp",
    system: {
      description: { value: `
<p><strong>Hunter's Mark (Class Feature)</strong> — replaces Favored Enemy.</p>
<ul>
<li>Bonus action to mark up to N targets (N = 1 @1st, 2 @6th, 3 @14th). No transfer.</li>
<li>Uses per long rest = PB + WIS.</li>
<li>On hit vs a marked target: bonus damage scaling by Ranger level (module setting controls damage type).</li>
<li>Unleash Aspects (consume a mark): Detonation, Sight, Regeneration.</li>
<li>Marks end on Unleash, target death, or your long rest.</li>
</ul>` },
      activation: { type: "bonus", cost: 1 },
      uses: { value: 0, max: 0, per: "lr" },
      requirements: "Ranger",
      source: "Module: Ranger Rework"
    },
    flags: { [MODULE_ID]: { feature: true } }
  };
}

async function getSeedFeatureFromPack() {
  await ensurePack({ name: "features", label: "Ranger Rework - Features", type: "Item", system: "dnd5e" });
  const pack = game.packs.get(`${MODULE_ID}.features`);
  const index = await pack.getIndex();
  let entry = index.find(e => e.name === FEATURE_NAME);
  if (!entry) {
    const tmp = await Item.create(buildFeatureItemData(), { temporary: true });
    const doc = await pack.importDocument(tmp);
    await tmp.delete();
    entry = { _id: doc.id, name: doc.name };
  }
  return await pack.getDocument(entry._id);
}

/* -------------------- Effects & Visuals ---------------------- */
async function ensureMarkedEffect(targetActor, { on, origin, label = "Marked (Ranger)" }) {
  const existing = targetActor.effects.find(e => e.getFlag(MODULE_ID, "markIcon") && e.origin === origin);
  if (on) {
    if (existing) return existing;
    const effect = {
      name: label,
      icon: F.getIcon(),
      origin,
      disabled: false,
      duration: { seconds: null },
      flags: { [MODULE_ID]: { markIcon: true } }
    };
    const [created] = await targetActor.createEmbeddedDocuments("ActiveEffect", [effect]);
    return created;
  } else {
    if (existing) return existing.delete();
  }
}

/* ------------------------- Apply Mark ------------------------ */
async function applyMarksDialog(rangerActor) {
  const level = F.rangerLevel(rangerActor);
  const capacity = F.markCapacity(level);
  const current = F.countActiveMarksForRanger(rangerActor);
  const remainingSlots = Math.max(0, capacity - current);
  if (remainingSlots <= 0) return F.warn(`You already have ${current}/${capacity} targets marked.`);

  const usesMax = F.usesPerDay(rangerActor);
  const used = rangerActor.getFlag(MODULE_ID, "uses") ?? 0;
  if (used >= usesMax) return F.warn(`No uses remaining (used ${used}/${usesMax}).`);

  const userTargets = Array.from(game.user?.targets ?? []);
  if (!userTargets.length) return F.warn("Target at least one token.");

  const canMark = Math.min(remainingSlots, userTargets.length, (usesMax - used));
  const targets = userTargets.slice(0, canMark).map(t => t.actor).filter(Boolean);
  if (!targets.length) return;

  const die = F.levelToMarkDie(level);
  const origin = rangerActor.uuid;
  const ruuid = rangerActor.uuid;

  for (const ta of targets) {
    const already = F.getMarkOnTargetByRanger(ta, ruuid);
    if (already) continue;
    await F.setMarkOnTargetByRanger(ta, ruuid, { die, applied: Date.now(), origin, actorName: rangerActor.name });
    await ensureMarkedEffect(ta, { on: true, origin, label: `Marked by ${rangerActor.name}` });
  }

  await rangerActor.setFlag(MODULE_ID, "uses", used + 1); // 1 use per application (even if 2/3 targets at 6/14)
  const list = targets.map(t => `<li>${t.name}</li>`).join("");
  const usesLeft = usesMax - (used + 1);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: rangerActor }),
    content: `
<div class="rhr-card">
  <h3>Apply Mark</h3>
  <p><b>${rangerActor.name}</b> applies <i>Mark (${die}, ${F.getDmgType()})</i> to:</p>
  <ul>${list}</ul>
  <p><i>Uses Remaining:</i> ${usesLeft}/${usesMax} • <i>Capacity:</i> ${remainingSlots} → ${Math.max(0, remainingSlots - targets.length)}</p>
</div>`
  });
}

/* --------------------------- Unleash ------------------------- */
const Unleash = {
  async detonation({ ranger, targetToken }) {
    const target = targetToken?.actor;
    if (!ranger || !target) return;
    const mark = F.getMarkOnTargetByRanger(target, ranger.uuid);
    if (!mark) return F.warn("No mark to Unleash on this target.");

    const detFeet = 10;
    const pxPerGrid = canvas.grid.size;
    const feetPerGrid = canvas.grid.distance || 5;
    const radiusPx = (detFeet / feetPerGrid) * pxPerGrid;

    const myDisposition = ranger?.getActiveTokens()?.[0]?.document?.disposition;
    const inRange = canvas.tokens.placeables.filter(t => {
      if (!t.actor) return false;
      if (!F.ffOn() && t.document.disposition === myDisposition) return false;
      const dx = t.center.x - targetToken.center.x;
      const dy = t.center.y - targetToken.center.y;
      return Math.hypot(dx, dy) <= radiusPx;
    });

    const roll = await new Roll(mark.die).roll({ async: true });
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: ranger }),
      flavor: `<b>${ranger.name}</b> unleashes <i>Detonation</i> on ${targetToken.name} — <b>${mark.die} ${F.getDmgType()}</b> to all within ${detFeet} ft.`
    });

    for (const tkn of inRange) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: ranger }),
        content: `Detonation hits <b>${tkn.name}</b> for <b>${roll.total}</b> ${F.getDmgType()} damage. (Apply manually or via Midi-QOL.)`
      });
    }

    await F.deleteMarkOnTargetByRanger(target, ranger.uuid);
    await ensureMarkedEffect(target, { on: false, origin: ranger.uuid });
  },

  async sight({ ranger, targetToken }) {
    const target = targetToken?.actor;
    if (!ranger || !target) return;
    const mark = F.getMarkOnTargetByRanger(target, ranger.uuid);
    if (!mark) return F.warn("No mark to Unleash on this target.");

    const effect = {
      name: "Unleash: Sight (Perception/Survival Advantage)",
      icon: "icons/skills/awareness/eye-ringed-green.webp",
      origin: ranger.uuid,
      duration: { seconds: 60 },
      changes: [
        { key: "system.skills.prc.adv", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 1, priority: 20 },
        { key: "system.skills.sur.adv", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 1, priority: 20 }
      ],
      flags: { [MODULE_ID]: { unleash: "sight", targetUuid: target.uuid } }
    };
    await ranger.createEmbeddedDocuments("ActiveEffect", [effect]);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: ranger }),
      content: `<b>${ranger.name}</b> unleashes <i>Sight</i> on ${targetToken.name} (1 minute).`
    });

    await F.deleteMarkOnTargetByRanger(target, ranger.uuid);
    await ensureMarkedEffect(target, { on: false, origin: ranger.uuid });
  },

  async regeneration({ ranger, targetToken }) {
    const target = targetToken?.actor;
    if (!ranger || !target) return;
    const mark = F.getMarkOnTargetByRanger(target, ranger.uuid);
    if (!mark) return F.warn("No mark to Unleash on this target.");

    const wis = F.actorWISmod(ranger);
    const roll = await new Roll(mark.die).roll({ async: true });
    const heal = Math.max(1, (wis ?? 0) + roll.total);

    const hp = ranger.system.attributes.hp;
    await ranger.update({ "system.attributes.hp.value": F.clamp(hp.value + heal, 0, hp.max) });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: ranger }),
      content: `<b>${ranger.name}</b> unleashes <i>Regeneration</i> (heals <b>${heal}</b> HP).`
    });

    await F.deleteMarkOnTargetByRanger(target, ranger.uuid);
    await ensureMarkedEffect(target, { on: false, origin: ranger.uuid });
  }
};

/* ----------------------- Midi-QOL hook ----------------------- */
function registerMidiQolIntegration() {
  if (!game.modules.get("midi-qol")?.active) return;

  Hooks.on("midi-qol.DamageBonus", async (wf) => {
    try {
      const actor = wf?.actor;
      const target = wf?.targets?.first()?.actor;
      if (!actor || !target) return {};
      if (!F.isRanger(actor)) return {};

      const mark = F.getMarkOnTargetByRanger(target, actor.uuid);
      if (!mark) return {};

      return { damageRoll: `${mark.die}[${F.getDmgType()}]`, flavor: "Hunter's Mark (Class Feature)" };
    } catch { return {}; }
  });

  // Optional Detonation helper button on a hit
  Hooks.on("midi-qol.AttackRollComplete", async (wf) => {
    if (!wf.hitTargets.size) return;
    const actor = wf.actor;
    const targetToken = wf.hitTargets.first();
    const mark = F.getMarkOnTargetByRanger(targetToken.actor, actor.uuid);
    if (!mark) return;

    const content = `<button data-det="${targetToken.id}" data-actor="${actor.id}" class="rhr-det-btn">Unleash: Detonation</button>`;
    const msg = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
    Hooks.once("renderChatMessage", (app, html) => {
      html.find(".rhr-det-btn").on("click", async (ev) => {
        const tkn = canvas.tokens.get(ev.currentTarget.dataset.det);
        const act = game.actors.get(ev.currentTarget.dataset.actor);
        Unleash.detonation({ ranger: act, targetToken: tkn });
      });
    });
  });
}

/* ------------------- Core-only enhancements ------------------ */
function registerCoreEnhancements() {
  // Hotkey to roll mark damage after a hit (manual)
  game.keybindings.register(MODULE_ID, "mark-damage", {
    name: "Roll Mark Damage (Manual Hit Confirm)",
    editable: [{ key: "KeyM", modifiers: ["Alt"] }],
    onDown: async () => {
      const ranger = canvas.tokens.controlled[0]?.actor ?? game.user?.character;
      const target = Array.from(game.user.targets)[0]?.actor;
      if (!ranger || !target) return F.warn("Select your Ranger and target a marked enemy.");
      const mark = F.getMarkOnTargetByRanger(target, ranger.uuid);
      if (!mark) return F.warn("Target isn't marked by you.");
      const roll = await new Roll(`${mark.die}`).roll({ async: true });
      roll.toMessage({ flavor: `Hunter's Mark (manual): ${mark.die} ${F.getDmgType()} to ${target.name}` });
    }
  });

  // Optional chat button injection on attack messages
  Hooks.on("createChatMessage", async (msg) => {
    if (!F.coreBtns()) return;
    if (!msg.isRoll || !msg.rolls?.length) return;

    const user = game.user;
    const ranger = canvas.tokens.controlled[0]?.actor ?? user?.character;
    if (!ranger || !F.isRanger(ranger)) return;

    const target = Array.from(user.targets ?? [])[0]?.actor;
    if (!target) return;
    const mark = F.getMarkOnTargetByRanger(target, ranger.uuid);
    if (!mark) return;

    Hooks.once("renderChatMessage", (app, html) => {
      const btn = $(`<button class="rhr-core-btn">Roll Mark Damage</button>`);
      btn.on("click", async () => {
        const roll = await new Roll(`${mark.die}`).roll({ async: true });
        roll.toMessage({ flavor: `Hunter's Mark: ${mark.die} ${F.getDmgType()} to ${target.name}` });
      });
      html.find(".message-content").append(btn);
    });
  });
}

/* ----------------------- Ranger Panel (V2) ------------------- */
class RangerPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "rhr-panel",
    title: "Ranger: Hunter's Marks",
    width: 420,
    height: "auto",
    resizable: true
  };

  #ranger;

  constructor(ranger) {
    super();
    this.#ranger = ranger;
  }

  get ranger() { return this.#ranger; }

  async _prepareContext() {
    const a = this.ranger;
    const level = F.rangerLevel(a);
    const die = F.levelToMarkDie(level);
    const cap = F.markCapacity(level);
    const used = a.getFlag(MODULE_ID, "uses") ?? 0;
    const maxUses = F.usesPerDay(a);

    const entries = [];
    for (const t of canvas.tokens.placeables) {
      if (!t.actor) continue;
      const mark = F.getMarkOnTargetByRanger(t.actor, a.uuid);
      if (mark) entries.push({ tokenId: t.id, name: t.name, die: mark.die });
    }
    return {
      title: "Ranger: Hunter's Marks",
      die, cap,
      uses: { used, max: maxUses, remain: Math.max(0, maxUses - used) },
      marks: entries,
      dmgType: F.getDmgType()
    };
  }

  static PARTS = {
    header: { template: `<header class="p-2"><h3>{{title}}</h3></header>` },
    body: { template: `
    <section class="p-2">
      <p><b>Mark Die:</b> {{die}} ({{dmgType}}) • <b>Capacity:</b> {{cap}} • <b>Uses:</b> {{uses.used}} / {{uses.max}} ({{uses.remain}} left)</p>
      {{#if marks.length}}
        <ul>
          {{#each marks}}
            <li>
              <b>{{name}}</b> — {{die}}
              <button data-action="unleash" data-mode="detonation" data-token="{{tokenId}}">Detonation</button>
              <button data-action="unleash" data-mode="sight" data-token="{{tokenId}}">Sight</button>
              <button data-action="unleash" data-mode="regeneration" data-token="{{tokenId}}">Regeneration</button>
              <button data-action="remove" data-token="{{tokenId}}">Remove Mark</button>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <p>No active marks.</p>
      {{/if}}
    </section>`}
  };

  _onRender() {
    const html = this.element;
    html.querySelectorAll("button[data-action='unleash']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const token = canvas.tokens.get(ev.currentTarget.dataset.token);
        const mode = ev.currentTarget.dataset.mode;
        if (!token) return;
        if (mode === "detonation") return Unleash.detonation({ ranger: this.ranger, targetToken: token });
        if (mode === "sight") return Unleash.sight({ ranger: this.ranger, targetToken: token });
        if (mode === "regeneration") return Unleash.regeneration({ ranger: this.ranger, targetToken: token });
      });
    });
    html.querySelectorAll("button[data-action='remove']").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const token = canvas.tokens.get(ev.currentTarget.dataset.token);
        if (!token?.actor) return;
        await F.deleteMarkOnTargetByRanger(token.actor, this.ranger.uuid);
        await ensureMarkedEffect(token.actor, { on: false, origin: this.ranger.uuid });
        ui.notifications.info(`Removed mark from ${token.name}.`);
        this.render(true);
      });
    });
  }
}

/* ---------------------- Scene Controls btn ------------------- */
function addSceneControlButton() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const token = controls.find(c => c.name === "token");
    if (!token) return;
    token.tools.push({
      name: "rhr-panel",
      title: "Ranger: Hunter's Marks",
      icon: "fas fa-bullseye",
      visible: true,
      onClick: () => {
        const ranger = canvas.tokens.controlled[0]?.actor ?? game.user?.character;
        if (!ranger) return F.warn("Select your Ranger token or set a character.");
        if (!F.isRanger(ranger)) return F.warn("Your selected actor is not a Ranger.");
        (new RangerPanel(ranger)).render(true);
      }
    });
  });
}

/* --------------------------- HUD ----------------------------- */
function registerTokenHUD() {
  Hooks.on("getTokenHUDButtons", (hud, buttons) => {
    const t = hud.object; // Token
    const user = game.user;

    // Apply Mark
    buttons.unshift({
      icon: "fas fa-bullseye",
      label: "Apply Mark",
      visible: !!(user?.character || canvas.tokens.controlled.length),
      onclick: async () => {
        const ranger = canvas.tokens.controlled[0]?.actor ?? user.character;
        if (!ranger) return F.warn("No ranger actor found (select your token or set a character).");
        if (!F.isRanger(ranger)) return F.warn("This feature is for Rangers.");
        return applyMarksDialog(ranger);
      }
    });

    // Unleash
    buttons.unshift({
      icon: "fas fa-bolt",
      label: "Unleash",
      visible: true,
      onclick: async () => {
        const ranger = canvas.tokens.controlled[0]?.actor ?? user?.character;
        if (!ranger) return F.warn("Select your Ranger token.");
        const actor = t.actor;
        const opts = [
          { id: "detonation", label: "Detonation" },
          { id: "sight", label: "Sight" },
          { id: "regeneration", label: "Regeneration" }
        ];
        const choice = await new Promise(res => {
          new Dialog({
            title: "Unleash Aspect",
            content: `<p>Choose an Aspect to unleash on <b>${actor.name}</b>:</p>`,
            buttons: Object.fromEntries(opts.map(o => [o.id, { icon: "<i class='fas fa-check'></i>", label: o.label, callback: () => res(o.id) }])),
            default: "detonation",
            close: () => res(null)
          }).render(true);
        });
        if (!choice) return;
        if (choice === "detonation") return Unleash.detonation({ ranger, targetToken: t });
        if (choice === "sight") return Unleash.sight({ ranger, targetToken: t });
        if (choice === "regeneration") return Unleash.regeneration({ ranger, targetToken: t });
      }
    });
  });
}

/* -------------------------- Cleanup -------------------------- */
async function onLongRest(actor) {
  if (!F.isRanger(actor)) return;
  await actor.unsetFlag(MODULE_ID, "uses");
  for (const t of canvas.tokens.placeables) {
    if (!t.actor) continue;
    const mark = F.getMarkOnTargetByRanger(t.actor, actor.uuid);
    if (mark) {
      await F.deleteMarkOnTargetByRanger(t.actor, actor.uuid);
      await ensureMarkedEffect(t.actor, { on: false, origin: actor.uuid });
    }
  }
  F.info(`${actor.name}: Hunter's marks cleared and uses reset.`);
}

async function onActorDeathCleanup(actor, changes) {
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if (hp !== 0) return;
  const marks = actor.getFlag(MODULE_ID, "marks") || {};
  if (Object.keys(marks).length) {
    for (const [ruuid] of Object.entries(marks)) {
      await F.deleteMarkOnTargetByRanger(actor, ruuid);
    }
    const effects = actor.effects.filter(e => e.getFlag(MODULE_ID, "markIcon"));
    for (const ef of effects) await ef.delete();
  }
}

/* -------------- Auto-Replace Favored Enemy Logic ------------- */
async function replaceFavoredOnActor(actor) {
  if (!actor || !F.isRanger(actor)) return false;

  // Originals to catch: name match (en-GB variants), identifier
  const toRemove = actor.items.filter(i => {
    if (i.type !== "feat") return false;
    const n = (i.name || "").toLowerCase().trim();
    return n === "favored enemy" || n === "favoured enemy" || i.getFlag("dnd5e", "identifier") === "favored-enemy";
  });

  const haveNew = actor.items.some(i => i.getFlag(MODULE_ID, "feature") || i.name === FEATURE_NAME);

  let added = false;
  if (!haveNew) {
    const featDoc = await getSeedFeatureFromPack();
    const created = await actor.createEmbeddedDocuments("Item", [featDoc.toObject()]);
    added = !!created?.length;
  }

  if (toRemove.length) {
    await actor.deleteEmbeddedDocuments("Item", toRemove.map(i => i.id));
  }

  return added || toRemove.length > 0;
}

async function migrateReplaceFavoredAll() {
  if (!game.user.isGM) return;
  if (!F.autoReplace()) return;

  const actors = game.actors.contents.filter(a => a.type === "character" && F.isRanger(a));
  let changed = 0;
  for (const a of actors) {
    try { if (await replaceFavoredOnActor(a)) changed++; } catch (e) { console.warn(e); }
  }
  if (changed) ui.notifications.info(`Ranger Rework: Replaced Favored Enemy on ${changed} Ranger(s).`);
}

// Guard: when someone tries to add Favored Enemy in the future, swap it immediately.
Hooks.on("preCreateItem", async (doc, data, options, userId) => {
  try {
    const parent = doc?.parent;
    if (!(parent instanceof Actor)) return;
    if (!F.isRanger(parent)) return;
    if (!F.autoReplace()) return;

    const isFeat = data?.type === "feat";
    const name = (data?.name || "").toLowerCase().trim();
    const idf  = data?.flags?.dnd5e?.identifier;
    const isFavoredEnemy = isFeat && (name === "favored enemy" || name === "favoured enemy" || idf === "favored-enemy");
    if (!isFavoredEnemy) return;

    const featDoc = await getSeedFeatureFromPack();
    await parent.createEmbeddedDocuments("Item", [featDoc.toObject()]);
    ui.notifications.info(`Ranger Rework: Replaced "Favored Enemy" with new class feature on ${parent.name}.`);
    return false; // cancel original creation
  } catch (e) {
    console.warn(`${MODULE_ID} preCreateItem swap failed`, e);
    return;
  }
});

/* --------------------------- Hooks --------------------------- */
Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  // UI wiring & integrations
  registerTokenHUD();
  registerMidiQolIntegration();
  registerCoreEnhancements();
  addSceneControlButton();

  if (game.user.isGM) {
    // Ensure compendium packs exist
    await ensurePack({ name: "features", label: "Ranger Rework - Features", type: "Item", system: "dnd5e" });
    await ensurePack({ name: "macros",   label: "Ranger Rework - Macros",   type: "Macro" });
    await ensurePack({ name: "effects",  label: "Ranger Rework - Effects",  type: "Item", system: "dnd5e" });

    // Seed feature if missing
    const pack = game.packs.get(`${MODULE_ID}.features`);
    const index = await pack.getIndex();
    const exists = index.some(e => e.name === FEATURE_NAME);
    if (!exists) {
      const tmp = await Item.create(buildFeatureItemData(), { temporary: true });
      await pack.importDocument(tmp);
      await tmp.delete();
      ui.notifications.info("Ranger Rework: Feature seeded to compendium. Drag it to your Ranger.");
    }

    // Auto-migrate Favored Enemy replacement, if enabled
    await migrateReplaceFavoredAll();
  }

  // Expose API
  if (game.modules.get(MODULE_ID)) {
    game.modules.get(MODULE_ID).api = {
      applyMarksDialog,
      ensureMarkedEffect,
      Unleash,
      openPanel: (actor) => (new RangerPanel(actor)).render(true)
    };
  }
});

Hooks.on("dnd5e.restCompleted", async (actor, data) => { if (data?.longRest) await onLongRest(actor); });
Hooks.on("updateActor", onActorDeathCleanup);
