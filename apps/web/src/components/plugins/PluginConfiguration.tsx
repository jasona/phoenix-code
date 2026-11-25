import { useState } from "react";
import { useGT } from "gt-react";
import type { PluginInstallation, PluginRequestInput } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";

export function PluginConfiguration({
  entry,
  disabled,
  onSave,
}: {
  entry: PluginInstallation;
  disabled: boolean;
  onSave: (input: PluginRequestInput) => Promise<void>;
}) {
  const gt = useGT();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => ({
    ...Object.fromEntries(
      Object.entries(entry.manifest.configuration ?? {}).map(([key, field]) => [
        key,
        field.default,
      ]),
    ),
    ...entry.configuration,
  }));
  if (!entry.manifest.configuration || Object.keys(entry.manifest.configuration).length === 0)
    return null;
  return (
    <details className="text-sm">
      <summary>{gt("Configuration")}</summary>
      <div className="space-y-3 py-3">
        {Object.entries(entry.manifest.configuration).map(([key, field]) => (
          <label key={key} className="flex flex-col gap-1">
            {field.title}
            {typeof field.default === "boolean" ? (
              <Checkbox
                checked={values[key] === true}
                disabled={disabled}
                onCheckedChange={(value) => setValues({ ...values, [key]: value })}
              />
            ) : (
              <Input
                value={String(values[key] ?? field.default)}
                disabled={disabled}
                type={typeof field.default === "number" ? "number" : "text"}
                onChange={(event) =>
                  setValues({
                    ...values,
                    [key]:
                      typeof field.default === "number"
                        ? Number(event.target.value)
                        : event.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onSave({ action: "configure", pluginId: entry.manifest.id, configuration: values })
          }
        >
          {gt("Save and restart")}
        </Button>
      </div>
    </details>
  );
}
