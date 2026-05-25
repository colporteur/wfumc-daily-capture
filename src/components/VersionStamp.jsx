// Tiny version marker rendered at the bottom of every page so we know
// when a deploy actually picked up.

const buildTime =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'local';
const buildSha =
  typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'local';

export default function VersionStamp() {
  let stamp = buildSha;
  try {
    const d = new Date(buildTime);
    if (!isNaN(d.getTime())) {
      stamp = `${buildSha} · ${d.toLocaleString()}`;
    }
  } catch {
    /* fall through */
  }
  return (
    <p className="text-[10px] text-gray-400 mt-12 text-center select-none">
      build {stamp}
    </p>
  );
}
