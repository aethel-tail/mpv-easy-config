async function loadOptions() {
    const res = await fetch("./data/options.json", { cache: "no-cache" });
    if (!res.ok)
        return null;
    return (await res.json());
}
export async function boot() {
    const mount = document.querySelector("#app");
    if (!mount)
        throw new Error("missing #app");
    const data = await loadOptions();
    if (!data) {
        mount.textContent = "options data not generated yet (M1)";
        return;
    }
    const kinds = new Map();
    for (const option of data.options) {
        kinds.set(option.widget.kind, (kinds.get(option.widget.kind) ?? 0) + 1);
    }
    const summary = [...kinds].map(([kind, n]) => `${kind} ${n}`).join(" · ");
    mount.textContent = `${data.options.length} options · mpv master@${data.mpvCommit.slice(0, 7)} · ${summary}`;
}
void boot();
