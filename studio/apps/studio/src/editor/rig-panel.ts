import type { Bone, Ease } from "@gas/core";
import { DEFAULT_SHARPNESS, DEFAULT_SOFTNESS, setBinding } from "@gas/engine";
import { h } from "../dom";
import { es } from "../es";
import { setPressed } from "./ui";
import type { EditorModel } from "./model";
import { boneColor } from "./rig-overlay";

const R = es.rig;

function numberField(label: string, testid: string, opts: { step?: number; min?: number; max?: number }, onCommit: (v: number) => void) {
  const input = h("input", { type: "number", inputmode: "decimal", step: opts.step ?? 1, min: opts.min, max: opts.max, "data-testid": testid, "aria-label": label });
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
  });
  const el = h("label", { class: "field num" }, h("span", {}, label), input);
  return {
    el, input,
    set(v: number) {
      if (document.activeElement !== input) input.value = String(Math.round(v * 1000) / 1000);
    },
  };
}

function selectField(label: string, testid: string, onChange: (v: string) => void) {
  const sel = h("select", { "data-testid": testid, "aria-label": label });
  sel.addEventListener("change", () => onChange(sel.value));
  sel.addEventListener("keydown", (e) => e.stopPropagation());
  return { el: h("label", { class: "field" }, h("span", {}, label), sel), sel };
}

const btn = (label: string, testid: string, onclick: () => void, cls = "") => h("button", { type: "button", class: `btn sm ${cls}`.trim(), "data-testid": testid, onclick }, label);

/** Panel «Esqueleto»: esqueletos, huesos, vínculos de capa, influencias y poses. Actualización dirigida (no recrea lo que se está arrastrando). */
export class RigPanel {
  readonly el: HTMLElement;
  private readonly skSelect: HTMLSelectElement;
  private readonly body = h("div", { class: "rig-body" });
  private readonly empty = h("p", { class: "hint" }, R.none);
  private readonly tree = h("ul", { class: "bone-tree", "data-testid": "bone-tree", role: "listbox", "aria-label": R.bones });
  private readonly modeEdit: HTMLButtonElement;
  private readonly modePose: HTMLButtonElement;
  private readonly hintMode = h("p", { class: "hint" });
  private readonly tShow: HTMLButtonElement;
  private readonly tWeights: HTMLButtonElement;
  private readonly tRest: HTMLButtonElement;
  private readonly tCreate: HTMLButtonElement;
  private readonly props = h("div", { class: "rig-props", "data-testid": "bone-props" });
  private readonly f = {
    name: h("input", { type: "text", maxlength: 60, "data-testid": "bone-name", "aria-label": R.name }),
    parent: selectField(R.parent, "bone-parent", (v) => this.m.reparentBone(v === "" ? null : v)),
    length: numberField(R.length, "bone-length", { min: 1, step: 1 }, (v) => this.m.updateBone({ length: v })),
    angle: numberField(R.restAngle, "bone-angle", { step: 1 }, (v) => this.m.updateBone({ angle: v })),
    ax: numberField(R.anchor, "bone-ax", { step: 0.05 }, (v) => this.m.updateBone({ ax: v })),
    ay: numberField(R.anchorSide, "bone-ay", { step: 1 }, (v) => this.m.updateBone({ ay: v })),
    min: numberField(R.min, "bone-min", { step: 1 }, (v) => this.m.updateBone({ min: v })),
    max: numberField(R.max, "bone-max", { step: 1 }, (v) => this.m.updateBone({ max: v })),
    rot: numberField(R.rotation, "bone-rot", { step: 1 }, (v) => { this.m.poseBoneLive(this.m.rig.boneId!, { r: v }); this.m.rigEnd(); }),
    tx: numberField(R.moveX, "bone-tx", { step: 1 }, (v) => this.setRoot({ x: v })),
    ty: numberField(R.moveY, "bone-ty", { step: 1 }, (v) => this.setRoot({ y: v })),
  };
  private readonly rotSlider = h("input", { type: "range", step: 1, "data-testid": "bone-rot-slider", "aria-label": R.rotation });
  private readonly editOnly: HTMLElement[] = [];
  private readonly poseOnly: HTMLElement[] = [];
  // Vínculo
  private readonly bindMode = selectField(R.layer, "bind-mode", (v) => this.applyBinding(v));
  private readonly bindBone = selectField(R.bindBone, "bind-bone", () => this.applyBinding(this.bindMode.sel.value));
  private readonly influences = h("div", { class: "infl", "data-testid": "bind-influences" });
  private readonly soft = h("input", { type: "range", min: 1, max: 200, step: 1, "data-testid": "bind-softness", "aria-label": R.softness });
  private readonly sharp = h("input", { type: "range", min: 5, max: 80, step: 1, "data-testid": "bind-sharpness", "aria-label": R.sharpness });
  private readonly softOut = h("output", { class: "range-out" });
  private readonly sharpOut = h("output", { class: "range-out" });
  private readonly bindSkinBox = h("div", { class: "bind-skin" });
  private readonly bindHint = h("p", { class: "hint" });
  private readonly bindTitle = h("h4", {});
  private readonly boundList = h("ul", { class: "bound-list", "data-testid": "bound-list" });
  // Poses
  private readonly frameState = h("p", { class: "frame-state", "data-testid": "frame-key-state", "aria-live": "polite" });
  private readonly easeSel = selectField(R.ease, "key-ease", (v) => this.m.setKeyEase(v as Ease));
  private readonly keyList = h("div", { class: "key-list", "data-testid": "key-list" });
  private readonly btns: Record<string, HTMLButtonElement> = {};
  /** Firmas del contenido de las listas: solo se reconstruyen si cambian (un arrastre no debe recrear 40 filas por movimiento). */
  private sig = { tree: "", parents: "", bind: "", infl: "", bound: "", keys: "" };

  constructor(private readonly m: EditorModel) {
    this.skSelect = h("select", { "data-testid": "rig-skeleton", "aria-label": R.skeleton });
    this.skSelect.addEventListener("change", () => m.selectSkeleton(this.skSelect.value));
    this.skSelect.addEventListener("keydown", (e) => e.stopPropagation());

    this.modeEdit = h("button", { type: "button", class: "chip", role: "radio", "data-testid": "rig-mode-edit", onclick: () => m.setRigMode("edit") }, R.modeEdit) as HTMLButtonElement;
    this.modePose = h("button", { type: "button", class: "chip", role: "radio", "data-testid": "rig-mode-pose", onclick: () => m.setRigMode("pose") }, R.modePose) as HTMLButtonElement;
    const tog = (label: string, testid: string, key: "show" | "weights" | "restView") => h("button", { type: "button", class: "chip", "aria-pressed": "false", "data-testid": testid, onclick: () => m.toggleRig(key) }, label) as HTMLButtonElement;
    this.tShow = tog(R.show, "rig-toggle-show", "show");
    this.tWeights = tog(R.weights, "rig-toggle-weights", "weights");
    this.tRest = tog(R.restView, "rig-toggle-rest", "restView");
    this.tCreate = h("button", { type: "button", class: "chip", "aria-pressed": "false", "data-testid": "rig-create", title: R.drawBoneHint, onclick: () => m.setCreate(!m.rig.create) }, R.drawBone) as HTMLButtonElement;

    // propiedades del hueso
    this.f.name.addEventListener("change", () => m.updateBone({ name: this.f.name.value }));
    this.f.name.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") this.f.name.blur(); });
    this.rotSlider.addEventListener("input", () => m.poseBoneLive(m.rig.boneId!, { r: Number(this.rotSlider.value) }));
    this.rotSlider.addEventListener("change", () => m.rigEnd());
    this.f.rot.input.addEventListener("input", () => undefined);
    const editFields = [this.f.parent.el, this.f.length.el, this.f.angle.el, this.f.ax.el, this.f.ay.el, this.f.min.el, this.f.max.el];
    this.editOnly.push(...editFields);
    const rotRow = h("div", { class: "pose-rot" }, h("label", { class: "field" }, h("span", {}, R.rotation), this.rotSlider), this.f.rot.el);
    this.poseOnly.push(rotRow, this.f.tx.el, this.f.ty.el);
    this.btns["resetBone"] = btn(R.resetBone, "bone-reset", () => { if (m.bone) { m.poseBoneLive(m.bone.id, m.bone.parent ? { r: 0 } : { r: 0, x: 0, y: 0 }); m.rigEnd(); } });
    this.poseOnly.push(this.btns["resetBone"]!);
    this.props.append(
      h("h4", {}, R.boneProps),
      h("label", { class: "field" }, h("span", {}, R.name), this.f.name),
      ...editFields,
      rotRow, h("div", { class: "grid2" }, this.f.tx.el, this.f.ty.el), this.btns["resetBone"]!,
    );

    // vínculo
    this.soft.addEventListener("input", () => { this.softOut.textContent = `${this.soft.value} px`; this.applyBinding("skin", true); });
    this.soft.addEventListener("change", () => this.m.rigEnd());
    this.sharp.addEventListener("input", () => { this.sharpOut.textContent = (Number(this.sharp.value) / 10).toFixed(1); this.applyBinding("skin", true); });
    this.sharp.addEventListener("change", () => this.m.rigEnd());
    this.bindSkinBox.append(
      h("label", { class: "range" }, h("span", { class: "range-label" }, R.softness, this.softOut), this.soft),
      h("label", { class: "range" }, h("span", { class: "range-label" }, R.sharpness, this.sharpOut), this.sharp),
      h("h5", {}, R.influences), this.influences,
    );

    // poses
    this.btns["save"] = btn(R.saveKey, "key-save", () => m.saveKey(), "primary");
    this.btns["delete"] = btn(R.deleteKey, "key-delete", () => m.deleteKey());
    this.btns["prev"] = btn("◀ " + R.prevKey, "key-prev", () => m.gotoKey(-1));
    this.btns["next"] = btn(R.nextKey + " ▶", "key-next", () => m.gotoKey(1));
    this.btns["dup"] = btn(R.dupKey, "key-dup", () => m.duplicateKeyToNext());
    this.btns["copy"] = btn(R.copyPose, "pose-copy", () => m.copyPoseToClipboard());
    this.btns["paste"] = btn(R.pastePose, "pose-paste", () => m.pastePoseFromClipboard());
    this.btns["reset"] = btn(R.resetPose, "pose-reset", () => m.resetPose());
    for (const [v, t] of [["linear", R.easeLinear], ["smooth", R.easeSmooth], ["step", R.easeStep]] as const) this.easeSel.sel.append(h("option", { value: v }, t));

    const skBtns = h("div", { class: "row" },
      btn(R.newSkeleton, "rig-new", () => m.createSkeleton(), "primary"),
      h("button", { type: "button", class: "btn sm", "data-testid": "rig-humanoid", title: R.humanoidHint, onclick: () => m.createHumanoid() }, R.humanoid),
    );
    const skManage = h("div", { class: "row" },
      btn(R.rename, "rig-rename", () => { const sk = m.skeleton; if (!sk) return; const n = prompt(R.renamePrompt, sk.name); if (n && n.trim()) m.renameSkeleton(n); }),
      btn(R.remove, "rig-remove", () => { const sk = m.skeleton; if (sk && confirm(R.confirmRemove(sk.name))) m.removeSkeleton(); }),
    );
    this.body.append(
      skManage,
      h("div", { class: "chips", role: "radiogroup", "aria-label": "Modo" }, this.modeEdit, this.modePose),
      this.hintMode,
      h("div", { class: "chips" }, this.tShow, this.tWeights, this.tRest, this.tCreate),
      h("h4", {}, R.bones), this.tree,
      h("div", { class: "row" }, btn("+ " + R.addChild, "bone-add-child", () => m.addChildBone()), btn(R.removeBone, "bone-remove", () => m.removeSelectedBone())),
      this.props,
      this.bindTitle,
      this.bindMode.el, this.bindBone.el, this.bindSkinBox, this.bindHint,
      h("h5", {}, R.bound), this.boundList,
      btn(R.sync, "rig-sync", () => { if (confirm(R.confirmSync)) { m.syncRigLayers(); m.notice(R.syncDone); } }),
      h("h4", {}, R.poses), this.frameState,
      h("div", { class: "row" }, this.btns["save"]!, this.btns["delete"]!),
      h("div", { class: "row" }, this.btns["prev"]!, this.btns["next"]!),
      h("div", { class: "row" }, this.btns["dup"]!, this.btns["copy"]!, this.btns["paste"]!, this.btns["reset"]!),
      this.easeSel.el,
      h("h5", {}, R.keys), this.keyList,
    );

    this.el = h("section", { class: "panel-section rig-section", "data-section": "rig" }, h("h3", {}, R.title), skBtns, h("label", { class: "field" }, h("span", {}, R.skeleton), this.skSelect), this.empty, this.body);
    this.update();
  }

  private setRoot(v: { x?: number; y?: number }): void {
    const b = this.m.bone;
    if (!b || b.parent) return;
    const cur = this.m.rigStates()!.pose.get(b.id)!;
    this.m.poseBoneLive(b.id, { r: cur.r, x: v.x ?? cur.x, y: v.y ?? cur.y });
    this.m.rigEnd();
  }

  private applyBinding(mode: string, live = false): void {
    const m = this.m;
    const layerId = m.layerId;
    const sk = m.skeleton;
    if (!sk) return;
    if (mode === "none") return m.setBinding(layerId, null);
    const bone = this.bindBone.sel.value || sk.bones[0]?.id;
    if (!bone) return m.notice("El esqueleto no tiene huesos: crea alguno antes de vincular.");
    const inf = [...this.influences.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
    const binding = { mode: mode as "rigid" | "skin", bone, influences: mode === "skin" ? [...new Set([bone, ...inf])] : [], softness: Number(this.soft.value) || DEFAULT_SOFTNESS, sharpness: (Number(this.sharp.value) || DEFAULT_SHARPNESS * 10) / 10 };
    if (live) m.rigLive((d) => setBinding(d, sk.id, layerId, binding));
    else m.setBinding(layerId, binding);
  }

  private boneRow(b: Bone, depth: number, index: number): HTMLElement {
    const sel = this.m.rig.boneId === b.id;
    const li = h("li", { role: "option", "aria-selected": String(sel) });
    const btnEl = h("button", { type: "button", class: `bone-row ${sel ? "on" : ""}`, "data-testid": "bone-row", "data-bone-id": b.id, style: `padding-left:${8 + depth * 14}px`, onclick: () => this.m.selectBone(b.id) },
      h("span", { class: "bone-chip", style: `background:${boneColor(index)}` }), h("span", { class: "bone-name" }, b.name));
    li.append(btnEl);
    return li;
  }

  update(): void {
    const m = this.m;
    const rigs = m.doc.rigs ?? [];
    const sk = m.skeleton;
    const editing = m.rig.mode === "edit";

    // selector de esqueleto
    const want = rigs.map((r) => `${r.id}:${r.name}`).join("|");
    if (this.skSelect.dataset["sig"] !== want) {
      this.skSelect.dataset["sig"] = want;
      this.skSelect.replaceChildren(...(rigs.length ? rigs.map((r) => h("option", { value: r.id }, r.name)) : [h("option", { value: "" }, R.none)]));
    }
    this.skSelect.value = m.rig.skeletonId ?? "";
    this.skSelect.disabled = rigs.length === 0;
    this.empty.hidden = !!sk;
    this.body.hidden = !sk;
    if (!sk) return;

    setPressed(this.modeEdit, editing);
    setPressed(this.modePose, !editing);
    this.modeEdit.setAttribute("aria-checked", String(editing));
    this.modePose.setAttribute("aria-checked", String(!editing));
    this.hintMode.textContent = editing ? R.modeHintEdit : R.modeHintPose;
    setPressed(this.tShow, m.rig.show);
    setPressed(this.tWeights, m.rig.weights);
    setPressed(this.tRest, m.rig.restView);
    setPressed(this.tCreate, m.rig.create);
    this.tRest.hidden = editing;
    this.tCreate.hidden = !editing;

    // árbol de huesos
    const treeSig = sk.bones.map((b) => `${b.id}:${b.name}:${b.parent}`).join("|") + `#${m.rig.boneId}`;
    if (treeSig !== this.sig.tree) {
      this.sig.tree = treeSig;
      const depth = new Map<string, number>();
      const rows: HTMLElement[] = [];
      sk.bones.forEach((b, i) => {
        depth.set(b.id, b.parent ? (depth.get(b.parent) ?? 0) + 1 : 0);
        rows.push(this.boneRow(b, depth.get(b.id)!, i));
      });
      this.tree.replaceChildren(...(rows.length ? rows : [h("li", { class: "hint" }, R.noBones)]));
      this.tree.querySelector(".bone-row.on")?.scrollIntoView({ block: "nearest" });
    }

    // propiedades del hueso
    const b = m.bone;
    this.props.hidden = !b;
    if (b) {
      const info = m.rigStates()!;
      this.editOnly.forEach((e) => (e.hidden = !editing));
      this.poseOnly.forEach((e) => (e.hidden = editing));
      if (document.activeElement !== this.f.name) this.f.name.value = b.name;
      const p = info.sk.bones;
      const parentsSig = `${b.id}|${b.parent}|` + p.map((x) => `${x.id}:${x.name}:${x.parent}`).join(",");
      if (parentsSig !== this.sig.parents) {
        this.sig.parents = parentsSig;
        this.f.parent.sel.replaceChildren(h("option", { value: "" }, R.root), ...p.filter((x) => x.id !== b.id && !this.isDesc(info.sk.bones, b.id, x.id)).map((x) => h("option", { value: x.id, selected: x.id === b.parent }, x.name)));
      }
      this.f.parent.sel.value = b.parent ?? "";
      this.f.length.set(b.length);
      this.f.angle.set(b.angle);
      this.f.ax.set(b.ax);
      this.f.ay.set(b.ay);
      this.f.min.set(b.min);
      this.f.max.set(b.max);
      this.f.ax.el.hidden = !editing || !b.parent;
      this.f.ay.el.hidden = !editing || !b.parent;
      const cur = info.pose.get(b.id)!;
      this.rotSlider.min = String(Math.max(-360, b.min));
      this.rotSlider.max = String(Math.min(360, b.max));
      if (document.activeElement !== this.rotSlider) this.rotSlider.value = String(Math.round(cur.r));
      this.f.rot.set(cur.r);
      this.f.tx.el.hidden = editing || !!b.parent;
      this.f.ty.el.hidden = editing || !!b.parent;
      this.f.tx.set(cur.x);
      this.f.ty.set(cur.y);
    }

    // vínculo de la capa activa
    const layer = m.layer;
    const lb = m.layerBinding;
    const mine = lb && lb.skeleton.id === sk.id ? lb.binding : null;
    this.bindTitle.textContent = `${R.binding}: «${layer.name}»`;
    const modeWant = `${mine ? mine.mode : "none"}`;
    if (this.bindMode.sel.options.length !== 3) this.bindMode.sel.replaceChildren(h("option", { value: "none" }, R.bindNone), h("option", { value: "rigid" }, R.bindRigid), h("option", { value: "skin" }, R.bindSkin));
    this.bindMode.sel.value = modeWant;
    const boneSig = sk.bones.map((x) => `${x.id}:${x.name}`).join(",");
    if (boneSig !== this.sig.bind) {
      this.sig.bind = boneSig;
      this.bindBone.sel.replaceChildren(...sk.bones.map((x) => h("option", { value: x.id }, x.name)));
    }
    this.bindBone.sel.value = mine?.bone ?? m.rig.boneId ?? sk.bones[0]?.id ?? "";
    this.bindBone.el.hidden = !mine;
    this.bindSkinBox.hidden = mine?.mode !== "skin";
    this.bindHint.textContent = !mine ? "" : mine.mode === "rigid" ? R.bindHintRigid : R.bindHintSkin;
    if (mine?.mode === "skin") {
      if (document.activeElement !== this.soft) this.soft.value = String(Math.round(mine.softness));
      if (document.activeElement !== this.sharp) this.sharp.value = String(Math.round(mine.sharpness * 10));
      this.softOut.textContent = `${Math.round(mine.softness)} px`;
      this.sharpOut.textContent = mine.sharpness.toFixed(1);
      const inflSig = boneSig + "#" + mine.influences.join(",");
      if (inflSig !== this.sig.infl) {
        this.sig.infl = inflSig;
        this.influences.replaceChildren(...sk.bones.map((x, i) => {
          const cb = h("input", { type: "checkbox", value: x.id, checked: mine.influences.includes(x.id), "data-testid": "bind-infl" });
          cb.addEventListener("change", () => this.applyBinding("skin"));
          return h("label", { class: "check infl-row" }, cb, h("span", { class: "bone-chip", style: `background:${boneColor(i)}` }), h("span", {}, x.name));
        }));
      }
    }
    // lista de capas vinculadas
    const boundSig = sk.bindings.map((bd) => `${bd.layerId}:${bd.bone}:${bd.mode}`).join(",") + "#" + m.doc.layers.map((l) => `${l.id}:${l.name}`).join(",");
    if (boundSig !== this.sig.bound) {
      this.sig.bound = boundSig;
      this.boundList.replaceChildren(...(sk.bindings.length
        ? sk.bindings.map((bd) => {
            const l = m.doc.layers.find((x) => x.id === bd.layerId);
            const bn = sk.bones.find((x) => x.id === bd.bone);
            const idx = sk.bones.findIndex((x) => x.id === bd.bone);
            return h("li", {}, h("button", { type: "button", class: "bound-row", "data-testid": "bound-row", onclick: () => m.setLayer(bd.layerId) },
              h("span", { class: "bone-chip", style: `background:${boneColor(idx)}` }), h("span", {}, `${l?.name ?? "?"} → ${bn?.name ?? "?"}`), h("em", {}, bd.mode === "skin" ? "deformable" : "rígido")));
          })
        : [h("li", { class: "hint" }, R.noBound)]));
    }

    // poses
    const i = m.frameIndex;
    const keyed = m.hasKeyHere;
    const anyKeys = m.keyFrameList.length > 0;
    this.frameState.textContent = R.frameState(i + 1, keyed ? "key" : anyKeys ? "interp" : "none");
    this.btns["delete"]!.disabled = !keyed;
    this.btns["paste"]!.disabled = !m.poseClipboard;
    this.btns["dup"]!.disabled = i + 1 >= m.doc.frames.length;
    this.easeSel.el.hidden = !keyed;
    if (keyed) this.easeSel.sel.value = m.doc.frames[i]!.poses![sk.id]!.ease;
    const keys = m.keyFrameList;
    const keysSig = keys.join(",") + "#" + i;
    if (keysSig !== this.sig.keys) {
      this.sig.keys = keysSig;
      this.keyList.replaceChildren(...(keys.length ? keys.map((k) => h("button", { type: "button", class: `chip ${k === i ? "on" : ""}`, "data-testid": "key-chip", onclick: () => m.setFrameIndex(k) }, String(k + 1))) : [h("span", { class: "hint" }, R.noKeys)]));
    }
  }

  private isDesc(bones: readonly Bone[], root: string, id: string): boolean {
    let cur = bones.find((x) => x.id === id);
    while (cur?.parent) {
      if (cur.parent === root) return true;
      cur = bones.find((x) => x.id === cur!.parent);
    }
    return false;
  }
}

