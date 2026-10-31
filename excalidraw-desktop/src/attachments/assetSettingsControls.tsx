/** Controls of the `files.show_assets` and `[images]` rows; spread into pages/index.ts. */
import { useEffect, useState } from "react";

import { Segmented, Stepper } from "../components/settings/pages/controls";
import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import { ASSET_LIMITS, type AssetPreferences } from "./assetSettings";

const usePref = <K extends keyof AssetPreferences>(field: K) => {
  const { win } = useSettings();
  const [value, setValue] = useState<AssetPreferences[K]>(
    () => getPreferences(win)[field] as AssetPreferences[K],
  );
  useEffect(() => {
    const refresh = () =>
      setValue(getPreferences(win)[field] as AssetPreferences[K]);
    refresh();
    return subscribePreferences(refresh);
  }, [win, field]);
  const set = (next: AssetPreferences[K]) => {
    setValue(next);
    updatePreferences({ [field]: next } as Partial<AssetPreferences>, win);
  };
  return [value, set] as const;
};

const ShowAssets = () => {
  const [value, set] = usePref("filesShowAssets");
  return (
    <SettingRow id="files-show-assets">
      <Segmented
        label="Other files in the tree"
        value={value}
        onChange={set}
        options={[
          { label: "None", val: "none" },
          { label: "Pictures and PDFs", val: "media" },
          { label: "All files", val: "all" },
        ]}
      />
    </SettingRow>
  );
};

const Compress = () => {
  const [value, set] = usePref("imagesCompress");
  return (
    <SettingRow id="images-compress">
      <Segmented
        label="Shrink big pictures"
        value={value}
        onChange={set}
        options={[
          { label: "Off", val: "off" },
          { label: "Shrink", val: "auto" },
        ]}
      />
    </SettingRow>
  );
};

const MaxSide = () => {
  const [value, set] = usePref("imagesMaxSide");
  return (
    <SettingRow id="images-max-side">
      <Stepper
        label="Longest side of a shrunk picture"
        value={value}
        onChange={set}
        unit="px"
        {...ASSET_LIMITS.imagesMaxSide}
      />
    </SettingRow>
  );
};

const MaxInsert = () => {
  const [value, set] = usePref("imagesMaxInsertMb");
  return (
    <SettingRow id="images-max-insert-mb">
      <Stepper
        label="Largest picture a drawing takes"
        value={value}
        onChange={set}
        unit="MB"
        {...ASSET_LIMITS.imagesMaxInsertMb}
      />
    </SettingRow>
  );
};

export const assetControls: SettingControls = {
  "files-show-assets": { Component: ShowAssets },
  "images-compress": { Component: Compress },
  "images-max-side": { Component: MaxSide },
  "images-max-insert-mb": { Component: MaxInsert },
};
