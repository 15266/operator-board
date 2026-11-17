import { useRef } from "react";
import { ACTION, GLOSSARY_GROUPS } from "../lib/copy";
import { ArchiveText } from "./ArchiveText";

export function GlossaryButton() {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => ref.current?.showModal()}
      >
        <ArchiveText zh={ACTION.glossary.zh} en={ACTION.glossary.en} />
      </button>
      <dialog ref={ref} className="glossary-dialog" aria-labelledby="glossary-title">
        <header className="glossary-head">
          <div>
            <h2 id="glossary-title">
              <ArchiveText zh={ACTION.glossary.zh} en={ACTION.glossary.en} />
            </h2>
            <p className="muted">接口名保持英文；左侧等宽显示，右侧是白话说明。</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()}>
            <ArchiveText zh={ACTION.close.zh} en={ACTION.close.en} />
          </button>
        </header>
        <div className="glossary-body">
          {GLOSSARY_GROUPS.map((group) => (
            <section key={group.title} className="glossary-group">
              <h3>{group.title}</h3>
              <dl>
                {group.entries.map((e) => (
                  <div key={e.term} className="glossary-row">
                    <dt>
                      <code>{e.term}</code>
                    </dt>
                    <dd>{e.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
