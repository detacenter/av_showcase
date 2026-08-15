// The actual iframe lives in <GenresFrameHost>, mounted once at the app level so it
// survives navigating away from /stats — this div just marks where it should be
// positioned (see GenresFrameHost's slot-rect sync).
export function GenresTab() {
  return <div id="genres-frame-slot" style={{ flex: 1, minHeight: 0 }} />;
}
