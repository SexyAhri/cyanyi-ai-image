import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  STYLING_REFERENCE_MODES,
  STYLING_TARGET_REFERENCES,
  type StylingReferenceMode,
  type StylingTargetReferenceKind,
} from "../../../lib/creative/ecommerceTools";
import type { InputImage } from "../../../types";

export default function EcommerceStylingPanel(props: {
  inputImages: InputImage[];
  hasProductReference: boolean;
  pendingTargetReferenceKind: StylingTargetReferenceKind;
  setPendingTargetReferenceKind: Dispatch<
    SetStateAction<StylingTargetReferenceKind>
  >;
  setStylingEnabled: Dispatch<SetStateAction<boolean>>;
  setStylingMode: Dispatch<SetStateAction<StylingReferenceMode>>;
  setStylingNotes: Dispatch<SetStateAction<string>>;
  stylingEnabled: boolean;
  stylingMode: StylingReferenceMode;
  stylingNotes: string;
  targetReferenceIds: Record<StylingTargetReferenceKind, string[]>;
  targetReferenceInputRef: RefObject<HTMLInputElement | null>;
  onTargetReferenceUpload: (
    kind: StylingTargetReferenceKind,
    files: FileList | null,
  ) => void;
}) {
  return (
    <div className="rounded-2xl border border-pink-100 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            特换装 / 场景替换
          </div>
          <p className="mt-1 text-xs text-gray-400">
            必须基于参考图使用，先选择要锁住模特、服装还是场景。
          </p>
        </div>
        <button
          type="button"
          onClick={() => props.setStylingEnabled((value) => !value)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            props.stylingEnabled
              ? "bg-pink-600 text-white"
              : "bg-pink-50 text-pink-700 hover:bg-pink-100 dark:bg-pink-500/10 dark:text-pink-200"
          }`}
        >
          {props.stylingEnabled ? "已开启" : "已关闭"}
        </button>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {STYLING_REFERENCE_MODES.map((mode) => {
          const active = props.stylingMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                props.setStylingMode(mode.id);
                if (!props.stylingEnabled) props.setStylingEnabled(true);
              }}
              className={`rounded-xl border px-2.5 py-2 text-left transition ${
                active
                  ? "border-pink-300 bg-pink-50 text-pink-900 dark:border-pink-300/40 dark:bg-pink-500/20 dark:text-pink-100"
                  : "border-gray-200 bg-white text-gray-700 hover:border-pink-200 hover:bg-pink-50 dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-200"
              }`}
            >
              <span className="block text-xs font-medium">{mode.label}</span>
              <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
                {mode.hint}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mb-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-3 dark:border-pink-400/20 dark:bg-pink-500/10">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-pink-800 dark:text-pink-100">
              目标参考图
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
              想精准换衣服、换模特或换场景，就把目标也上传到这里。
            </p>
          </div>
          <input
            ref={props.targetReferenceInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) =>
              void props.onTargetReferenceUpload(
                props.pendingTargetReferenceKind,
                event.target.files,
              )
            }
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {STYLING_TARGET_REFERENCES.map((item) => {
            const refs = props.targetReferenceIds[item.id]
              .map((id) => props.inputImages.find((image) => image.id === id))
              .filter((image): image is InputImage => Boolean(image));
            return (
              <div
                key={item.id}
                className="rounded-xl border border-white/80 bg-white/80 p-2 dark:border-white/[0.08] dark:bg-black/20"
              >
                <button
                  type="button"
                  onClick={() => {
                    props.setPendingTargetReferenceKind(item.id);
                    props.targetReferenceInputRef.current?.click();
                  }}
                  className="w-full rounded-lg bg-pink-600 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-pink-500"
                >
                  上传{item.label.replace("目标", "")}
                </button>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-400">
                  {item.hint}
                </p>
                {refs.length > 0 && (
                  <div className="mt-2 flex gap-1 overflow-x-auto">
                    {refs.map((image) => (
                      <div
                        key={image.id}
                        className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-white/[0.08]"
                      >
                        <img
                          src={image.dataUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!props.hasProductReference && props.stylingEnabled && (
        <div className="mb-3 rounded-xl bg-red-50 p-2 text-xs leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          换装/换模特必须先上传参考图，否则无法保证同一模特或同一套衣服。
        </div>
      )}
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-200">
          补充要求，可选
        </span>
        <textarea
          value={props.stylingNotes}
          onChange={(event) => props.setStylingNotes(event.target.value)}
          placeholder="例如：保留发型和脸型；衣服颜色按目标参考；背景换成办公室暖光；不要改变包包 Logo。"
          rows={3}
          className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-pink-300 dark:border-white/[0.08] dark:bg-black/20"
        />
      </label>
    </div>
  );
}
