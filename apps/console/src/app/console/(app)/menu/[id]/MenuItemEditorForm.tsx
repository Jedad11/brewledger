"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, RecipeBlock } from "@brewledger/ui";
import { thbToSatang, satangToThb } from "@brewledger/shared/dist/money";
import { compressImage } from "@brewledger/shared/dist/storage/compress";
import { saveMenuItem, uploadMenuItemPhoto, type SaveMenuItemInput } from "./actions";

export interface MenuItemEditorOption {
  id: string | null;
  name: string;
  priceDeltaSatang: number;
}

export interface MenuItemEditorOptionGroup {
  id: string | null;
  name: string;
  options: MenuItemEditorOption[];
}

export interface MenuItemEditorInitialData {
  id: string;
  name: string;
  description: string | null;
  priceSatang: number;
  imagePath: string | null;
  imageUrl: string | null;
  optionGroups: MenuItemEditorOptionGroup[];
}

const SAVE_SUCCESS = "บันทึกแล้ว";
const NAME_REQUIRED = "กรอกชื่อรายการ";
const PRICE_REQUIRED = "กรอกราคา";
const PRICE_INVALID = "ราคาต้องมากกว่า 0 บาท";
const PHOTO_UPLOAD_ERROR = "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

interface DraftOption {
  key: string;
  name: string;
  priceDeltaThb: string;
}
interface DraftGroup {
  key: string;
  name: string;
  options: DraftOption[];
}

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

function toDraftGroups(groups: MenuItemEditorOptionGroup[]): DraftGroup[] {
  return groups.map((g) => ({
    key: nextDraftKey(),
    name: g.name,
    options: g.options.map((o) => ({
      key: nextDraftKey(),
      name: o.name,
      priceDeltaThb: String(satangToThb(o.priceDeltaSatang)),
    })),
  }));
}

export function MenuItemEditorForm({ storeId, item }: { storeId: string; item: MenuItemEditorInitialData | null }) {
  const router = useRouter();

  const [itemId, setItemId] = React.useState<string | null>(item?.id ?? null);
  const [name, setName] = React.useState(item?.name ?? "");
  const [priceThb, setPriceThb] = React.useState(item ? String(satangToThb(item.priceSatang)) : "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = React.useState<string | null>(item?.imageUrl ?? null);
  const [optionGroups, setOptionGroups] = React.useState<DraftGroup[]>(() => toDraftGroups(item?.optionGroups ?? []));

  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  const priceSatang = priceThb.trim() === "" ? null : thbToSatang(Number(priceThb));
  const nameError = touched && name.trim().length === 0 ? NAME_REQUIRED : undefined;
  const priceError = touched
    ? priceThb.trim() === ""
      ? PRICE_REQUIRED
      : !priceSatang || priceSatang <= 0
        ? PRICE_INVALID
        : undefined
    : undefined;
  const canSubmit = name.trim().length > 0 && !!priceSatang && priceSatang > 0;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoError(null);
  }

  function addOptionGroup() {
    setOptionGroups((groups) => [...groups, { key: nextDraftKey(), name: "", options: [] }]);
  }
  function removeOptionGroup(groupKey: string) {
    setOptionGroups((groups) => groups.filter((g) => g.key !== groupKey));
  }
  function updateGroupName(groupKey: string, value: string) {
    setOptionGroups((groups) => groups.map((g) => (g.key === groupKey ? { ...g, name: value } : g)));
  }
  function addOption(groupKey: string) {
    setOptionGroups((groups) =>
      groups.map((g) =>
        g.key === groupKey ? { ...g, options: [...g.options, { key: nextDraftKey(), name: "", priceDeltaThb: "0" }] } : g,
      ),
    );
  }
  function removeOption(groupKey: string, optionKey: string) {
    setOptionGroups((groups) =>
      groups.map((g) => (g.key === groupKey ? { ...g, options: g.options.filter((o) => o.key !== optionKey) } : g)),
    );
  }
  function updateOption(groupKey: string, optionKey: string, patch: Partial<DraftOption>) {
    setOptionGroups((groups) =>
      groups.map((g) =>
        g.key === groupKey
          ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || saving || !priceSatang) return;

    setSaving(true);
    setError(null);
    setSavedAt(null);
    setPhotoError(null);

    const input: SaveMenuItemInput = {
      itemId,
      storeId,
      name,
      priceSatang,
      description: description.trim() || null,
      optionGroups: optionGroups.map((g) => ({
        name: g.name,
        options: g.options.map((o) => ({
          name: o.name,
          priceDeltaSatang: thbToSatang(Number(o.priceDeltaThb || "0")),
        })),
      })),
    };

    const result = await saveMenuItem(input);
    if ("error" in result) {
      setSaving(false);
      setError(result.error);
      return;
    }

    let photoUploadFailed = false;
    if (photoFile) {
      try {
        // Compression stays in the browser (WBS 3.8, Canvas-only) but the
        // actual Storage write goes through a Server Action -- the browser
        // Supabase client can never carry the merchant's session (the
        // session cookie is httpOnly per WBS 4.1), so a browser-client
        // storage call always runs as `anon` and RLS rejects it.
        const compressed = await compressImage(photoFile, { mimeType: "image/webp" });
        const formData = new FormData();
        formData.set("file", compressed, "photo.webp");
        const uploadResult = await uploadMenuItemPhoto(result.item.id, storeId, formData);
        if ("error" in uploadResult) throw new Error(uploadResult.error);
      } catch (err) {
        // Photo upload failure never fails the item save -- the photo is
        // optional (WBS 4.4), the item itself already saved successfully.
        // The merchant still needs to know their photo didn't stick, so this
        // surfaces separately from `error` rather than being swallowed.
        console.error("menu item photo upload failed", err);
        photoUploadFailed = true;
        setPhotoError(PHOTO_UPLOAD_ERROR);
      }
    }

    setSaving(false);
    setSavedAt(Date.now());

    if (!itemId) {
      setItemId(result.item.id);
      // A failed photo needs its error read before the route change remounts
      // this form (fresh server props) and discards photoError with it --
      // stay put so the merchant can see it and retry from here.
      if (!photoUploadFailed) {
        router.replace(`/console/menu/${result.item.id}`);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="quiet" onClick={() => router.push("/console/menu")}>
        ย้อนกลับ
      </Button>
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">
        {itemId ? "แก้ไขรายการ" : "รายการใหม่"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            <Input
              label="ชื่อรายการ"
              placeholder="เช่น ลาเต้เย็น"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
            />
            <Input
              label="ราคา"
              placeholder="60"
              inputMode="decimal"
              value={priceThb}
              onChange={(e) => setPriceThb(e.target.value)}
              error={priceError}
            />

            {error ? (
              <p role="alert" className="err">
                {error}
              </p>
            ) : null}
            {savedAt && !error ? (
              <p className="note-plain" role="status">
                {SAVE_SUCCESS}
              </p>
            ) : null}

            <Button type="submit" wet loading={saving} disabled={!canSubmit}>
              บันทึก
            </Button>

            <hr className="hair" />

            <div className="field">
              <label>รูปภาพ</label>
              <label className="oc-drop">
                {photoPreviewUrl ? (
                  <img
                    src={photoPreviewUrl}
                    alt=""
                    style={{ width: 72, height: 72 }}
                    className="rounded-(--radius-input) object-cover"
                  />
                ) : (
                  <div className="oc-photo" style={{ width: 72, height: 72 }} aria-hidden="true" />
                )}
                <span className="note-plain">แตะเพื่อถ่ายหรือเลือกรูป</span>
                <input type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
              </label>
              {photoError ? (
                <p role="alert" className="err">
                  {photoError}
                </p>
              ) : null}
            </div>

            <Input
              label="คำอธิบาย"
              placeholder="นมสดกับเอสเพรสโซ่สองช็อต"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <OptionGroupsEditor
              groups={optionGroups}
              onAddGroup={addOptionGroup}
              onRemoveGroup={removeOptionGroup}
              onGroupNameChange={updateGroupName}
              onAddOption={addOption}
              onRemoveOption={removeOption}
              onOptionChange={updateOption}
            />
          </div>
        </Card>
      </form>

      {/* WBS 4.4 / RL-2: this block is the point the whole entry exists to
          protect. A merchant who never opens it, or opens it and closes it
          empty, must reach exactly the same "saved successfully, item is
          sellable" outcome as one who fills it in fully -- saveMenuItem
          above never reads or requires anything from here. Recipe
          persistence itself (bom_lines) is WBS 6.7's scope, deferred: this
          renders RecipeBlock with no suggestion/recipe wiring, so its
          onUse/onChange are local-only and never call a save action. Do NOT
          add a badge, asterisk, confirmation, or "you should really add a
          recipe" copy here or anywhere near this component, now or later. */}
      <RecipeBlock itemName={name} recipe={null} suggestion={null} onUse={() => {}} onChange={() => {}} />
    </div>
  );
}

function OptionGroupsEditor({
  groups,
  onAddGroup,
  onRemoveGroup,
  onGroupNameChange,
  onAddOption,
  onRemoveOption,
  onOptionChange,
}: {
  groups: DraftGroup[];
  onAddGroup: () => void;
  onRemoveGroup: (groupKey: string) => void;
  onGroupNameChange: (groupKey: string, value: string) => void;
  onAddOption: (groupKey: string) => void;
  onRemoveOption: (groupKey: string, optionKey: string) => void;
  onOptionChange: (groupKey: string, optionKey: string, patch: Partial<DraftOption>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-bold">ตัวเลือก</label>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2 rounded-(--radius-card) border border-black/10 p-3">
          <Input
            label="ชื่อกลุ่มตัวเลือก"
            placeholder="เช่น ร้อน / เย็น / ปั่น"
            value={group.name}
            onChange={(e) => onGroupNameChange(group.key, e.target.value)}
          />
          {group.options.map((option) => (
            <div key={option.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="ตัวเลือก"
                  placeholder="เช่น ร้อน"
                  value={option.name}
                  onChange={(e) => onOptionChange(group.key, option.key, { name: e.target.value })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  label="ราคาเพิ่ม/ลด (บาท)"
                  inputMode="decimal"
                  placeholder="0"
                  value={option.priceDeltaThb}
                  onChange={(e) => onOptionChange(group.key, option.key, { priceDeltaThb: e.target.value })}
                />
              </div>
              <Button type="button" variant="quiet" onClick={() => onRemoveOption(group.key, option.key)}>
                ลบ
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="quiet" onClick={() => onAddOption(group.key)}>
              เพิ่มตัวเลือก
            </Button>
            <Button type="button" variant="quiet" onClick={() => onRemoveGroup(group.key)}>
              ลบกลุ่มตัวเลือกนี้
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={onAddGroup}>
        เพิ่มกลุ่มตัวเลือก
      </Button>
    </div>
  );
}
