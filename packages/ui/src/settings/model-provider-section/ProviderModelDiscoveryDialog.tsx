import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { fuzzyMatch } from "./utils.js";

/**
 * 探测结果是一次性的读操作事实：勾选状态只存活于本次对话框，
 * 打开时以“全部可导入模型”为初始选中；已存在 ID 禁用勾选，不能重复导入。
 */
export function ProviderModelDiscoveryDialog({
  open,
  models,
  existingModelIds,
  importing,
  importError,
  onImport,
  onOpenChange,
}: {
  open: boolean;
  models: readonly string[];
  existingModelIds: readonly string[];
  importing: boolean;
  importError: string | null;
  onImport: (modelIds: readonly string[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { intl } = useYCodeIntl();
  const existing = useMemo(() => new Set(existingModelIds), [existingModelIds]);
  const importableModels = useMemo(
    () => models.filter((modelId) => !existing.has(modelId)),
    [models, existing],
  );
  const [filterValue, setFilterValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    // 打开或拿到新探测结果时重置勾选与过滤。依赖 models 身份而非 existing：
    // 导入过程中 existing 增长不应清空剩余勾选，已导入项由导入计数与禁用态收敛。
    setSelectedIds(new Set(models));
    setFilterValue("");
  }, [open, models]);

  const visibleModels = importableModels.filter((modelId) => fuzzyMatch(modelId, filterValue));
  const selectedCount = importableModels.filter((modelId) => selectedIds.has(modelId)).length;
  const allVisibleSelected =
    visibleModels.length > 0 && visibleModels.every((modelId) => selectedIds.has(modelId));
  const someVisibleSelected =
    visibleModels.some((modelId) => selectedIds.has(modelId)) && !allVisibleSelected;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 导入期间不允许关闭；失败保留选择让用户直接重试。
        if (importing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[min(36rem,calc(100vh-4rem))] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.discoverModelsTitle" })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({ id: "settings.modelProvider.discoverModelsDescription" })}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 space-y-3">
          {models.length === 0 ? (
            <p className="px-1 py-6 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.discoverModelsEmpty" })}
            </p>
          ) : (
            <>
              <Input
                type="text"
                size="lg"
                className="font-mono"
                value={filterValue}
                placeholder={intl.formatMessage({
                  id: "settings.modelProvider.discoverModelsFilter",
                })}
                onChange={(event) => setFilterValue(event.target.value)}
              />
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  id="provider-model-discovery-select-all"
                  checked={
                    allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false
                  }
                  disabled={importing || visibleModels.length === 0}
                  onCheckedChange={(checked) => {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      for (const modelId of visibleModels) {
                        if (checked) next.add(modelId);
                        else next.delete(modelId);
                      }
                      return next;
                    });
                  }}
                />
                <label
                  htmlFor="provider-model-discovery-select-all"
                  className="text-ui-sm text-foreground-subtle"
                >
                  {intl.formatMessage({
                    id: "settings.modelProvider.discoverModelsSelectAll",
                  })}
                </label>
              </div>
              <div className="min-h-24 space-y-0.5 overflow-y-auto pr-1">
                {visibleModels.map((modelId) => {
                  const alreadyAdded = existing.has(modelId);
                  const disabled = importing || alreadyAdded;
                  return (
                    <label
                      key={modelId}
                      className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-hover disabled:cursor-not-allowed"
                      aria-disabled={disabled}
                    >
                      <Checkbox
                        checked={alreadyAdded ? true : selectedIds.has(modelId)}
                        disabled={disabled}
                        onCheckedChange={(checked) => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(modelId);
                            else next.delete(modelId);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-ui-base text-foreground">
                        {modelId}
                      </span>
                      {alreadyAdded ? (
                        <span className="shrink-0 text-ui-sm text-foreground-subtle">
                          {intl.formatMessage({ id: "settings.modelProvider.modelAlreadyAdded" })}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
                {visibleModels.length === 0 ? (
                  <p className="px-1 py-4 text-center text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({
                      id: "settings.modelProvider.discoverModelsNoMatch",
                    })}
                  </p>
                ) : null}
              </div>
            </>
          )}
          {importError ? (
            <p role="alert" className="text-ui-sm font-medium text-destructive">
              {importError}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            disabled={importing}
            onClick={() => onOpenChange(false)}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={importing || selectedCount === 0}
            onClick={() => {
              const selected = importableModels.filter((modelId) => selectedIds.has(modelId));
              onImport(selected);
            }}
          >
            {importing ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.discoverModelsImport" },
              { count: selectedCount },
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
