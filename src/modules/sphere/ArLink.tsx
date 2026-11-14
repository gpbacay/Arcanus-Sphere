"use client";

import { Box, Pencil, Plus, ScanLine, Trash2, View } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { experienceName, MAX_IMAGE_BYTES, WORLD_EXPERIENCE, WORLD_ID, type Experience, type ExperienceType } from "./experience";
import { createSavedExperience, deleteSavedExperience, listSavedExperiences, readExperience, updateSavedExperience } from "./experiences";

const KINDS: { type: ExperienceType; title: string; detail: string }[] = [
  { type: "world", title: "World tracking", detail: "The orb in the room. Tap a surface to place it." },
  { type: "image", title: "Image tracking", detail: "The orb on a picture. Point the camera at that image." },
];

function problem(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Keep the host the user typed (a tunnel, the computer's address) and point the path at this experience. */
function retarget(current: string, id: string) {
  const write = (url: URL) => {
    url.pathname = "/ar";
    url.search = "";
    url.hash = "";
    if (id !== WORLD_ID) url.searchParams.set("e", id);
    return url.toString();
  };
  try {
    return write(new URL(current));
  } catch {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? location.origin;
    return write(new URL("/ar", base.endsWith("/") ? base : `${base}/`));
  }
}

function imageExtension(url: string) {
  if (url.startsWith("data:image/png")) return "png";
  if (url.startsWith("data:image/webp")) return "webp";
  return "jpg";
}

/** View in AR, as an artifact: the experiences on this computer, and a QR code for the one you pick. */
export default function ArLink() {
  const mobile = useIsMobile();
  const [saved, setSaved] = useState<Experience[] | null>(null);
  const [failed, setFailed] = useState("");
  const [selected, setSelected] = useState(WORLD_ID);
  const [link, setLink] = useState(() => retarget(process.env.NEXT_PUBLIC_APP_URL ?? location.origin, WORLD_ID));
  const [qr, setQr] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftType, setDraftType] = useState<ExperienceType>("world");
  const [draftName, setDraftName] = useState("");
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [editing, setEditing] = useState("");
  const [armed, setArmed] = useState("");
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const fileFor = useRef<"draft" | string>("draft");
  const asked = useRef(new Set<string>());
  const skipBlur = useRef(false);
  const renaming = useRef(false);
  const draftUrlRef = useRef("");
  const previewsRef = useRef(previews);
  draftUrlRef.current = draftUrl;
  previewsRef.current = previews;

  const rows = [WORLD_EXPERIENCE, ...(saved ? [...saved].reverse() : [])];
  const current = rows.find((item) => item.id === selected) ?? WORLD_EXPERIENCE;
  const preview = current.type === "image" ? previews[current.id] : "";

  useEffect(() => {
    let live = true;
    listSavedExperiences()
      .then((items) => live && setSaved(items))
      .catch((err: unknown) => {
        if (!live) return;
        setSaved([]);
        setFailed(problem(err, "Could not load experiences."));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => setLink((currentLink) => retarget(currentLink, selected)), [selected]);

  useEffect(() => {
    if (current.type !== "image" || asked.current.has(current.id)) return;
    asked.current.add(current.id);
    const id = current.id;
    let live = true;
    void readExperience(id)
      .then((detail) => {
        if (!live || !detail?.image) return;
        setPreviews((prev) => ({ ...prev, [id]: detail.image as string }));
      })
      .catch((err: unknown) => {
        asked.current.delete(id);
        if (live) setFailed(problem(err, "Could not load the target image."));
      });
    return () => {
      live = false;
    };
  }, [current.id, current.type]);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(link, { width: 240, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b1018", light: "#ffffff" } })
      .then((data) => live && setQr(data))
      .catch(() => live && setQr(""));
    return () => {
      live = false;
    };
  }, [link]);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(""), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(
    () => () => {
      if (draftUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(draftUrlRef.current);
      for (const url of Object.values(previewsRef.current)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [],
  );

  let local = false;
  try {
    local = /^(localhost|127\.|\[::1\])/.test(new URL(link).hostname);
  } catch {
    // still typing
  }

  const pickFile = (target: "draft" | string) => {
    fileFor.current = target;
    fileRef.current?.click();
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (fileFor.current === "draft") remember(file);
    else void replaceImage(fileFor.current, file);
  };

  const remember = (file: File | null) => {
    setDraftFile(file);
    setDraftUrl((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : "";
    });
  };

  const openCreate = () => {
    setFailed("");
    setDraftType("world");
    setDraftName("");
    remember(null);
    setCreating(true);
  };

  const create = async () => {
    const name = experienceName(draftName);
    if (!name) return setFailed("Give it a name, up to 60 characters.");
    if (draftType === "image" && !draftFile) return setFailed("Choose the image the camera should recognize.");
    if (draftFile && draftFile.size > MAX_IMAGE_BYTES) return setFailed("That image is over 6 MB.");
    setBusy(true);
    setFailed("");
    try {
      const made = await createSavedExperience({ name, type: draftType, ...(draftType === "image" && draftFile ? { image: draftFile } : {}) });
      setSaved((items) => [...(items ?? []), made]);
      if (draftType === "image" && draftUrl) {
        asked.current.add(made.id);
        setPreviews((prev) => ({ ...prev, [made.id]: draftUrl }));
        setDraftFile(null);
        setDraftUrl(""); // the list owns this blob URL now; don't revoke it
      } else remember(null);
      setSelected(made.id);
      setCreating(false);
    } catch (err) {
      setFailed(problem(err, "Could not save the experience."));
    } finally {
      setBusy(false);
    }
  };

  const commitRename = async (id: string, input: HTMLInputElement) => {
    if (renaming.current) return;
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const name = experienceName(input.value);
    const previous = saved?.find((item) => item.id === id)?.name;
    if (!name) {
      setEditing("");
      setFailed("Give it a name, up to 60 characters.");
      return;
    }
    if (previous === name) {
      setEditing("");
      return;
    }
    renaming.current = true;
    setFailed("");
    try {
      const updated = await updateSavedExperience(id, { name });
      setSaved((items) => (items ?? []).map((item) => (item.id === id ? { ...item, name: updated.name } : item)));
      setEditing("");
    } catch (err) {
      setFailed(problem(err, "Could not rename the experience."));
    } finally {
      renaming.current = false;
    }
  };

  const remove = async (id: string) => {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    setArmed("");
    setBusy(true);
    setFailed("");
    try {
      await deleteSavedExperience(id);
      setSaved((items) => (items ?? []).filter((item) => item.id !== id));
      setPreviews((prev) => {
        if (prev[id]?.startsWith("blob:")) URL.revokeObjectURL(prev[id]);
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selected === id) setSelected(WORLD_ID);
    } catch (err) {
      setFailed(problem(err, "Could not delete the experience."));
    } finally {
      setBusy(false);
    }
  };

  const replaceImage = async (id: string, file: File) => {
    if (file.size > MAX_IMAGE_BYTES) return setFailed("That image is over 6 MB.");
    setBusy(true);
    setFailed("");
    try {
      await updateSavedExperience(id, { image: file });
      const url = URL.createObjectURL(file);
      asked.current.add(id);
      setPreviews((prev) => {
        if (prev[id]?.startsWith("blob:")) URL.revokeObjectURL(prev[id]);
        return { ...prev, [id]: url };
      });
    } catch (err) {
      setFailed(problem(err, "Could not replace the image."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="pane-head">
        <View size={16} aria-hidden />
        <h2>View in AR</h2>
        {creating ? null : (
          <button type="button" className="icon-btn" aria-label="New experience" onClick={openCreate}>
            <Plus size={16} />
          </button>
        )}
      </header>
      <div className="pane-body ar-link">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
        {creating ? (
          <form
            className="ar-create"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <p id="ar-kind-label">What should the phone's camera do?</p>
            <div className="ar-types" role="group" aria-labelledby="ar-kind-label">
              {KINDS.map((kind) => (
                <button key={kind.type} type="button" className="ar-type" aria-pressed={draftType === kind.type} onClick={() => setDraftType(kind.type)}>
                  {kind.type === "image" ? <ScanLine size={15} aria-hidden /> : <Box size={15} aria-hidden />}
                  <span>
                    <strong>{kind.title}</strong>
                    <small>{kind.detail}</small>
                  </span>
                </button>
              ))}
            </div>
            <label className="ar-field">
              Name
              <input className="field" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={60} required autoFocus autoComplete="off" />
            </label>
            {draftType === "image" ? (
              <div className="ar-file">
                <button type="button" className="btn" onClick={() => pickFile("draft")}>
                  {draftFile ? "Replace image" : "Choose image"}
                </button>
                {draftUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draftUrl} alt="" className="ar-marker" />
                ) : null}
                <p>Print it, or leave it on another screen. A sharp, high-contrast picture tracks best.</p>
              </div>
            ) : null}
            {failed ? (
              <p className="ar-warn" role="alert">
                {failed}
              </p>
            ) : null}
            <div className="row">
              <button type="button" className="btn" onClick={() => { remember(null); setCreating(false); }} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Create"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <ul className="entries ar-experiences">
              {rows.map((item) => (
                <li key={item.id}>
                  {editing === item.id ? (
                    <form
                      className="ar-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const input = event.currentTarget.elements.namedItem("name");
                        if (input instanceof HTMLInputElement) void commitRename(item.id, input);
                      }}
                    >
                      <input
                        name="name"
                        className="field"
                        defaultValue={item.name}
                        aria-label={`Rename ${item.name}`}
                        maxLength={60}
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          skipBlur.current = true;
                          setEditing("");
                        }}
                        onBlur={(event) => void commitRename(item.id, event.currentTarget)}
                      />
                    </form>
                  ) : (
                    <button type="button" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
                      {item.type === "image" ? <ScanLine size={15} aria-hidden /> : <Box size={15} aria-hidden />}
                      <span className="ar-exp-name truncate">{item.name}</span>
                      <span className="pane-sub">{item.type === "image" ? "Image" : "World"}</span>
                    </button>
                  )}
                  {item.id !== WORLD_ID && editing !== item.id ? (
                    <>
                      <button type="button" className="icon-btn" aria-label={`Rename ${item.name}`} onClick={() => setEditing(item.id)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="icon-btn" data-danger={armed === item.id || undefined} aria-label={armed === item.id ? `Delete ${item.name} now` : `Delete ${item.name}`} disabled={busy} onClick={() => void remove(item.id)}>
                        {armed === item.id ? "Delete" : <Trash2 size={14} />}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {saved === null && !failed ? <p className="pane-note">Loading experiences…</p> : null}
            <div className="ar-share">
              <p>{current.type === "image" ? "Scan to open this on your phone, then point that camera at the image." : "Scan with your phone's camera to put Arcanus in your room."}</p>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={`${current.name} target image`} className="ar-marker" />
              ) : null}
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={`QR code that opens ${current.name} in AR`} width={240} height={240} className="ar-qr" />
              ) : (
                <div className="ar-qr" style={{ width: 240, height: 240 }} />
              )}
              <input className="field" value={link} onChange={(event) => setLink(event.target.value)} aria-label="AR link" spellCheck={false} />
              {local ? <p className="ar-warn">A phone can&apos;t open localhost. Use this computer&apos;s network address or a tunnel, over HTTPS.</p> : null}
              {failed ? (
                <p className="ar-warn" role="alert">
                  {failed}
                </p>
              ) : null}
              <div className="row">
                <a className="btn" href={link} target="_blank" rel="noreferrer">
                  Open here
                </a>
                {preview ? (
                  <a className="btn" href={preview} download={`${current.name.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "target"}.${imageExtension(preview)}`}>
                    Save image
                  </a>
                ) : null}
                {current.type === "image" ? (
                  <button type="button" className="btn" disabled={busy} onClick={() => pickFile(current.id)}>
                    Replace image
                  </button>
                ) : null}
                {mobile ? (
                  <Link href={current.id === WORLD_ID ? "/ar" : `/ar?e=${current.id}`} className="btn btn-primary">
                    Start AR
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
