import { useState } from "react";

import { DEFAULT_ZOOM, clampZoom } from "../../../vault/zoom";
import {
  MAX_NOTICE_SECONDS,
  MAX_ZOOM,
  MIN_NOTICE_SECONDS,
  MIN_ZOOM,
} from "../../../vault/preferences";
import {
  SORT_LABELS,
  SORT_ORDERS,
  type SortOrder,
} from "../../../vault/sortOrder";
import {
  DEFAULT_UI_FONT_SIZE,
  HOME_PAGES,
  MAX_UI_FONT_FAMILY_LENGTH,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  updatePreferences,
  type HomePage,
} from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { usePreference } from "../usePreference";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Stepper, Switch } from "./controls";
import { ActivityBarEntriesSetting } from "./ActivityBarEntries";
import { ScopedRow } from "./scopedRow";

const isMac = () =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

const ZoomSetting = () => {
  const { zoom, setZoom } = useSettings();
  const mod = isMac() ? "Cmd" : "Ctrl";
  return (
    <SettingRow
      id="interface-zoom"
      description={`Scales the whole window. ${mod}+Shift +, - and 0 also work.`}
      onReset={zoom !== DEFAULT_ZOOM ? () => setZoom(DEFAULT_ZOOM) : undefined}
    >
      <div className="vault-setting-inline">
        <input
          type="range"
          className="vault-range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step="5"
          value={zoom}
          aria-label="Interface zoom"
          onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
        />
        <span className="vault-setting-readout" aria-live="polite">
          {zoom} %
        </span>
      </div>
    </SettingRow>
  );
};

const FontSizeSetting = () => {
  const size = usePreference("interfaceFontSize");
  return (
    <SettingRow
      id="interface-font-size"
      onReset={
        size !== DEFAULT_UI_FONT_SIZE
          ? () => updatePreferences({ interfaceFontSize: DEFAULT_UI_FONT_SIZE })
          : undefined
      }
    >
      <Stepper
        label="Interface font size"
        unit="px"
        min={MIN_UI_FONT_SIZE}
        max={MAX_UI_FONT_SIZE}
        step={1}
        value={size}
        onChange={(next) => updatePreferences({ interfaceFontSize: next })}
      />
    </SettingRow>
  );
};

/** Choices offered before typing a font name ("" = the default UI font). */
export const FONT_FAMILY_CHOICES: readonly { value: string; label: string }[] =
  [
    { value: "", label: "Default (Assistant)" },
    { value: "system-ui", label: "System font" },
    { value: "ui-serif", label: "Serif" },
    { value: "ui-monospace", label: "Monospace" },
  ];
const OTHER_FONT = "__other__";

const FontFamilySetting = () => {
  const family = usePreference("interfaceFontFamily");
  const preset = FONT_FAMILY_CHOICES.some((c) => c.value === family);
  const [typing, setTyping] = useState(!preset);
  const [draft, setDraft] = useState<string | null>(null);
  const showInput = typing || !preset;
  const commit = () => {
    if (draft === null) {
      return;
    }
    const next = draft.trim();
    setDraft(null);
    if (next !== family) {
      updatePreferences({ interfaceFontFamily: next });
    }
  };
  return (
    <SettingRow
      id="interface-font-family"
      onReset={
        family !== ""
          ? () => {
              setTyping(false);
              setDraft(null);
              updatePreferences({ interfaceFontFamily: "" });
            }
          : undefined
      }
    >
      <div className="vault-setting-inline">
        <select
          className="vault-input"
          aria-label="Interface font"
          value={showInput ? OTHER_FONT : family}
          onChange={(e) => {
            if (e.target.value === OTHER_FONT) {
              setTyping(true);
              return;
            }
            setTyping(false);
            setDraft(null);
            updatePreferences({ interfaceFontFamily: e.target.value });
          }}
        >
          {FONT_FAMILY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
          <option value={OTHER_FONT}>Other font…</option>
        </select>
        {showInput && (
          <input
            className="vault-input"
            aria-label="Font name"
            placeholder="Font name, e.g. Inter"
            spellCheck={false}
            maxLength={MAX_UI_FONT_FAMILY_LENGTH}
            value={draft ?? (preset ? "" : family)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit();
              } else if (e.key === "Escape" && draft !== null) {
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
        )}
      </div>
    </SettingRow>
  );
};

const ShowTagChipsSetting = () => {
  const { showTagChips, setShowTagChips } = useSettings();
  return (
    <SettingRow id="show-tag-chips" htmlFor="vault-show-tag-chips">
      <Switch
        id="vault-show-tag-chips"
        checked={showTagChips}
        onChange={setShowTagChips}
      />
    </SettingRow>
  );
};

export const HOME_PAGE_LABELS: Record<HomePage, string> = {
  full: "Actions and recent drawings",
  minimal: "Actions only",
  blank: "Blank",
};

const HomePageSetting = () => {
  const mode = usePreference("homePage");
  return (
    <SettingRow id="home-page">
      <select
        className="vault-input"
        aria-label="Start page"
        value={mode}
        onChange={(e) =>
          updatePreferences({ homePage: e.target.value as HomePage })
        }
      >
        {HOME_PAGES.map((m) => (
          <option key={m} value={m}>
            {HOME_PAGE_LABELS[m]}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const NoticeSecondsSetting = () => {
  const { noticeSeconds, setNoticeSeconds } = useSettings();
  return (
    <SettingRow id="notice-seconds">
      <Stepper
        label="Error notice time"
        unit="s"
        min={MIN_NOTICE_SECONDS}
        max={MAX_NOTICE_SECONDS}
        step={1}
        value={noticeSeconds}
        onChange={setNoticeSeconds}
      />
    </SettingRow>
  );
};

const ThumbnailsSetting = () => {
  const { thumbnails, setThumbnails } = useSettings();
  return (
    <SettingRow id="thumbnails" htmlFor="vault-thumbnails">
      <Switch
        id="vault-thumbnails"
        checked={thumbnails}
        onChange={setThumbnails}
      />
    </SettingRow>
  );
};

const ActivityBarSetting = () => (
  <ScopedRow id="activity-bar" field="activityBar">
    {(value, onChange) => (
      <Switch
        id="vault-activity-bar"
        checked={value}
        label="Activity bar"
        onChange={onChange}
      />
    )}
  </ScopedRow>
);

const SortOrderSetting = () => (
  <ScopedRow id="sort-order" field="navigatorSort">
    {(value, onChange) => (
      <select
        className="vault-input"
        aria-label="Navigator sort order"
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
      >
        {SORT_ORDERS.map((order) => (
          <option key={order} value={order}>
            {SORT_LABELS[order]}
          </option>
        ))}
      </select>
    )}
  </ScopedRow>
);

export const interfaceControls: SettingControls = {
  "interface-zoom": { Component: ZoomSetting },
  "interface-font-size": { Component: FontSizeSetting },
  "interface-font-family": { Component: FontFamilySetting },
  "show-tag-chips": { Component: ShowTagChipsSetting },
  "home-page": { Component: HomePageSetting },
  "notice-seconds": { Component: NoticeSecondsSetting },
  thumbnails: { Component: ThumbnailsSetting },
  "activity-bar": { Component: ActivityBarSetting },
  "activity-bar-entries": { Component: ActivityBarEntriesSetting },
  "sort-order": { Component: SortOrderSetting },
};
