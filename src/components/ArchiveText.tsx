/** Chinese display text plus a small uppercase English archival label. */
export function ArchiveText({ zh, en }: { zh: string; en: string }) {
  return (
    <>
      {zh}
      <span className="title-en">{en}</span>
    </>
  );
}
