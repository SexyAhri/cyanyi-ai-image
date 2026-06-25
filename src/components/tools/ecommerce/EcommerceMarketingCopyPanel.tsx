import type { Dispatch, SetStateAction } from "react";
import type { buildMarketingCopy } from "../../../lib/creative/ecommerceTools";

type MarketingCopy = ReturnType<typeof buildMarketingCopy>;

export default function EcommerceMarketingCopyPanel(props: {
  marketingCopy: MarketingCopy;
  setMarketingCopy: Dispatch<SetStateAction<MarketingCopy>>;
  onCopy: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-orange-100 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            文案和卖点自动生成
          </div>
          <p className="mt-1 text-xs text-gray-400">
            生成后会写入提示词，也可以先复制给运营改。
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={props.onCopy}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 dark:bg-white/[0.08] dark:text-gray-200"
          >
            复制
          </button>
          <button
            type="button"
            onClick={props.onRefresh}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500"
          >
            生成文案
          </button>
        </div>
      </div>
      <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-orange-700 dark:text-orange-200">
            海报标题
          </span>
          <input
            value={props.marketingCopy.title}
            onChange={(event) =>
              props.setMarketingCopy((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none dark:border-white/[0.08] dark:bg-black/20"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-orange-700 dark:text-orange-200">
            海报副标题
          </span>
          <textarea
            value={props.marketingCopy.subtitle}
            onChange={(event) =>
              props.setMarketingCopy((current) => ({
                ...current,
                subtitle: event.target.value,
              }))
            }
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none dark:border-white/[0.08] dark:bg-black/20"
          />
        </label>
      </div>
    </div>
  );
}
