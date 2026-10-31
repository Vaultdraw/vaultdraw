import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Switch } from "./controls";

import type { TagSort } from "../../../tags/types";

const SORTS: readonly { val: TagSort; label: string }[] = [
  { val: "name", label: "By name" },
  { val: "count", label: "By number of files" },
];

const AutocompleteSetting = () => {
  const { tags, setTags } = useSettings();
  return (
    <SettingRow id="tags-autocomplete" htmlFor="vault-tags-autocomplete">
      <Switch
        id="vault-tags-autocomplete"
        checked={tags.autocomplete}
        onChange={(autocomplete) => setTags({ autocomplete })}
      />
    </SettingRow>
  );
};

const PaneSortSetting = () => {
  const { tags, setTags } = useSettings();
  return (
    <SettingRow id="tags-pane-sort" htmlFor="vault-tags-pane-sort">
      <select
        id="vault-tags-pane-sort"
        className="vault-input"
        value={tags.paneSort}
        onChange={(e) => setTags({ paneSort: e.target.value as TagSort })}
      >
        {SORTS.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

export const tagsControls: SettingControls = {
  "tags-autocomplete": { Component: AutocompleteSetting },
  "tags-pane-sort": { Component: PaneSortSetting },
};
