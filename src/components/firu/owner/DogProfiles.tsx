"use client";

// Owner → Profile: user card (inline edit) + dog gallery with full CRUD.
// Add/edit dog dialog with photo picker from preset assets, tags chip input.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  MapPin,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { api, qk } from "@/lib/firu/api";
import { useFiruSession } from "@/lib/firu/session";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { DogDTO, SessionUserDTO, ZoneDTO } from "@/lib/firu/types";
import { easeOutExpo } from "@/lib/firu/motion";
import {
  Avatar,
  DogSizeBadge,
  EmptyState,
  SectionHeader,
} from "@/components/firu/shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TEMPERAMENTS = [
  { value: "CALM", key: "own.temperament.calm", cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800" },
  { value: "ENERGETIC", key: "own.temperament.energetic", cls: "bg-sun-soft text-amber-700 border-amber-300" },
  { value: "ANXIOUS", key: "own.temperament.anxious", cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
] as const;

const SIZES = [
  { value: "S", key: "own.size.S" },
  { value: "M", key: "own.size.M" },
  { value: "L", key: "own.size.L" },
] as const;

/** Preset dog photos generated for the demo. */
const DOG_PHOTOS = [1, 2, 3, 4, 5, 6, 7].map((n) => `/images/dogs/dog-${n}.png`);

function temperamentOf(t: string) {
  return TEMPERAMENTS.find((x) => x.value === t) ?? TEMPERAMENTS[0];
}

/* ------------------------------------------------------------------ */
/* Dog add/edit dialog                                                 */
/* ------------------------------------------------------------------ */

interface DogFormState {
  name: string;
  breed: string;
  size: "S" | "M" | "L";
  ageYears: string;
  temperament: "CALM" | "ENERGETIC" | "ANXIOUS";
  notes: string;
  vetPhone: string;
  photoUrl: string;
  tags: string[];
}

const EMPTY_DOG: DogFormState = {
  name: "",
  breed: "",
  size: "M",
  ageYears: "2",
  temperament: "CALM",
  notes: "",
  vetPhone: "",
  photoUrl: DOG_PHOTOS[0],
  tags: [],
};

function DogDialog({
  open,
  onOpenChange,
  dog,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dog: DogDTO | null; // null = create mode
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<DogFormState>(EMPTY_DOG);
  const [tagDraft, setTagDraft] = useState("");
  const [initialized, setInitialized] = useState(false);

  // sync form when opening with a different dog
  if (open && !initialized) {
    setForm(
      dog
        ? {
            name: dog.name,
            breed: dog.breed,
            size: dog.size,
            ageYears: String(dog.ageYears),
            temperament: dog.temperament,
            notes: dog.notes ?? "",
            vetPhone: dog.vetPhone ?? "",
            photoUrl: dog.photoUrl ?? DOG_PHOTOS[0],
            tags: dog.tags,
          }
        : EMPTY_DOG
    );
    setTagDraft("");
    setInitialized(true);
  }
  if (!open && initialized) setInitialized(false);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        breed: form.breed.trim(),
        size: form.size,
        ageYears: Math.max(0, Math.min(30, Number(form.ageYears) || 0)),
        temperament: form.temperament,
        notes: form.notes.trim() || undefined,
        vetPhone: form.vetPhone.trim() || undefined,
        photoUrl: form.photoUrl,
        tags: form.tags,
      };
      return dog
        ? api.patch<DogDTO>(`/api/dogs/${dog.id}`, payload)
        : api.post<DogDTO>("/api/dogs", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.dogs() });
      toast({
        title: dog ? t("own.dog.updatedToast") : t("own.dog.joinedToast", { name: form.name.trim() }),
        description: dog ? t("own.dog.updatedToastDesc") : t("own.dog.joinedToastDesc"),
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: t("own.dog.saveErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (t && !form.tags.includes(t) && form.tags.length < 8) {
      setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagDraft("");
  };

  const valid = form.name.trim().length > 0 && form.breed.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {dog ? t("own.dog.editTitle", { name: dog.name }) : t("own.dog.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {dog ? t("own.dog.editDesc") : t("own.dog.addDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Photo picker */}
          <div>
            <Label className="mb-1.5">{t("own.dog.photoLabel")}</Label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DOG_PHOTOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, photoUrl: p }))}
                  className={cn(
                    "shrink-0 rounded-2xl overflow-hidden border-2 transition-[border-color,opacity,box-shadow,transform] duration-200 ease-out-expo active:scale-[0.95]",
                    form.photoUrl === p
                      ? "border-primary ring-2 ring-primary/30 scale-105"
                      : "border-border opacity-70 hover:opacity-100"
                  )}
                  aria-label={t("own.dog.choosePhotoAria", { file: p.split("/").pop() ?? "" })}
                >
                  <img
                    src={p}
                    alt=""
                    className="size-16 object-cover bg-muted"
                    onError={(e) => {
                      e.currentTarget.src = "/images/brand/logo-mark-mint.png";
                    }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dog-name">{t("own.dog.nameLabel")}</Label>
              <Input
                id="dog-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Max"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dog-breed">{t("own.dog.breedLabel")}</Label>
              <Input
                id="dog-breed"
                value={form.breed}
                onChange={(e) => setForm((f) => ({ ...f, breed: e.target.value }))}
                placeholder="Golden Retriever"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("own.dog.sizeLabel")}</Label>
              <Select
                value={form.size}
                onValueChange={(v) => setForm((f) => ({ ...f, size: v as DogFormState["size"] }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dog-age">{t("own.dog.ageLabel")}</Label>
              <Input
                id="dog-age"
                type="number"
                min={0}
                max={30}
                value={form.ageYears}
                onChange={(e) => setForm((f) => ({ ...f, ageYears: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("own.dog.temperamentLabel")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPERAMENTS.map((tm) => (
                <button
                  key={tm.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, temperament: tm.value }))}
                  className={cn(
                    "rounded-2xl border-2 py-2 text-sm font-bold transition-[border-color,background-color,color,transform] duration-200 ease-out-expo active:scale-[0.97]",
                    form.temperament === tm.value
                      ? "border-primary bg-brand-soft text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                  aria-pressed={form.temperament === tm.value}
                >
                  {t(tm.key)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dog-tags">{t("own.dog.tagsLabel")}</Label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-secondary-foreground"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }))
                    }
                    aria-label={t("own.dog.removeTagAria", { tag })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              id="dog-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder={t("own.dog.tagsPh")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dog-notes">{t("own.dog.notesLabel")}</Label>
            <Textarea
              id="dog-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t("own.dog.notesPh")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dog-vet">{t("own.dog.vetLabel")}</Label>
            <Input
              id="dog-vet"
              value={form.vetPhone}
              onChange={(e) => setForm((f) => ({ ...f, vetPhone: e.target.value }))}
              placeholder="+591 3 0000000"
            />
          </div>

          <Button
            className="w-full rounded-full font-bold"
            disabled={!valid || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? t("own.saving") : dog ? t("own.dog.saveChanges") : t("own.dog.addCta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* User edit dialog                                                    */
/* ------------------------------------------------------------------ */

function UserEditDialog({
  open,
  onOpenChange,
  user,
  zones,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: SessionUserDTO;
  zones: ZoneDTO[];
}) {
  const { t } = useT();
  const { toast } = useToast();
  const setUser = useFiruSession((s) => s.setUser);
  const qc = useQueryClient();
  const [name, setName] = useState(user.name);
  const [zoneId, setZoneId] = useState(user.zoneId ?? zones[0]?.id ?? "");
  const [addressNote, setAddressNote] = useState(user.addressNote ?? "");
  const [initialized, setInitialized] = useState(false);

  if (open && !initialized) {
    setName(user.name);
    setZoneId(user.zoneId ?? zones[0]?.id ?? "");
    setAddressNote(user.addressNote ?? "");
    setInitialized(true);
  }
  if (!open && initialized) setInitialized(false);

  const saveMut = useMutation({
    mutationFn: () =>
      api.patch<SessionUserDTO>("/api/users/me", {
        name: name.trim(),
        zoneId: zoneId || undefined,
        addressNote: addressNote.trim() || undefined,
      }),
    onSuccess: (u) => {
      setUser(u);
      qc.invalidateQueries({ queryKey: qk.me });
      toast({ title: t("own.me.updatedToast"), description: t("own.me.updatedToastDesc") });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: t("own.dog.saveErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("own.me.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("own.me.editDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="me-name">{t("own.me.nameLabel")}</Label>
            <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("own.me.zoneLabel")}</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder={t("own.chooseZone")} />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-address">{t("own.me.addressLabel")}</Label>
            <Textarea
              id="me-address"
              rows={2}
              value={addressNote}
              onChange={(e) => setAddressNote(e.target.value)}
              placeholder={t("own.me.addressPh")}
            />
          </div>
          <Button
            className="w-full rounded-full font-bold"
            disabled={!name.trim() || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? t("own.saving") : t("c.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export function DogProfiles() {
  const { t } = useT();
  const user = useFiruSession((s) => s.user);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: zones } = useQuery({
    queryKey: qk.zones,
    queryFn: () => api.get<ZoneDTO[]>("/api/zones"),
  });
  const { data: dogs, isLoading } = useQuery({
    queryKey: qk.dogs(),
    queryFn: () => api.get<DogDTO[]>("/api/dogs"),
  });

  const [userEditOpen, setUserEditOpen] = useState(false);
  const [dogDialog, setDogDialog] = useState<{ open: boolean; dog: DogDTO | null }>({
    open: false,
    dog: null,
  });
  const [deleteDog, setDeleteDog] = useState<DogDTO | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/api/dogs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.dogs() });
      toast({ title: t("own.dog.deletedToast"), description: t("own.dog.deletedToastDesc") });
      setDeleteDog(null);
    },
    onError: (e: Error) =>
      toast({ title: t("own.dog.deleteErrTitle"), description: srvErr(e.message), variant: "destructive" }),
  });

  if (!user) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOutExpo}
      className="space-y-6"
    >
      {/* User card */}
      <div className="rounded-3xl border bg-card p-6 shadow-sm flex items-center gap-4 flex-wrap">
        <Avatar src={user.avatarUrl} name={user.name} size="lg" className="size-20" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-black tracking-tight">{user.name}</h1>
            <span className="rounded-full bg-brand-soft border border-primary/30 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              {t("shell.role.owner")}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Phone className="size-3.5" /> {user.phone}
            </span>
            {user.zoneName && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" /> {user.zoneName}
              </span>
            )}
          </div>
          {user.addressNote && (
            <p className="text-sm text-muted-foreground mt-1.5 flex items-start gap-1.5">
              <StickyNote className="size-3.5 mt-0.5 shrink-0" />
              {user.addressNote}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          className="rounded-full font-bold"
          onClick={() => setUserEditOpen(true)}
        >
          <Pencil className="size-4" /> {t("c.edit")}
        </Button>
      </div>

      {/* Dogs */}
      <div>
        <SectionHeader
          title={t("own.dogs.title")}
          subtitle={t("own.dogs.subtitle")}
        />
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-3xl border bg-card p-5 flex gap-4">
                <Skeleton className="size-20 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (dogs ?? []).length === 0 ? (
          <EmptyState
            icon={Plus}
            title={t("own.dogs.emptyTitle")}
            description={t("own.dogs.emptyDesc")}
            action={
              <Button
                className="rounded-full font-bold"
                onClick={() => setDogDialog({ open: true, dog: null })}
              >
                {t("own.dog.addCta")}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(dogs ?? []).map((d) => {
              const temp = temperamentOf(d.temperament);
              return (
                <div key={d.id} className="rounded-3xl border bg-card p-5 shadow-sm">
                  <div className="flex items-start gap-4">
                      <img
                      src={d.photoUrl ?? "/images/brand/logo-mark-mint.png"}
                      alt={t("own.dogPhotoAlt", { name: d.name })}
                      className="size-20 rounded-2xl object-cover border bg-muted shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-extrabold text-lg leading-tight">{d.name}</p>
                        <DogSizeBadge size={d.size} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {d.breed} ·{" "}
                        {d.ageYears === 0
                          ? t("own.ageUnder1")
                          : t(d.ageYears === 1 ? "own.ageYears.one" : "own.ageYears.many", {
                              count: d.ageYears,
                            })}
                      </p>
                      <span
                        className={cn(
                          "inline-flex mt-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold",
                          temp.cls
                        )}
                      >
                        {t(temp.key)}
                      </span>
                    </div>
                  </div>

                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {d.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {d.notes && (
                    <p className="text-sm text-muted-foreground leading-relaxed mt-3">
                      {d.notes}
                    </p>
                  )}

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full font-bold"
                      onClick={() => setDogDialog({ open: true, dog: d })}
                    >
                      <Pencil className="size-3.5" /> {t("c.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full font-bold text-destructive hover:text-destructive"
                      onClick={() => setDeleteDog(d)}
                    >
                      <Trash2 className="size-3.5" /> {t("c.delete")}
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Add dog CTA card */}
            <button
              onClick={() => setDogDialog({ open: true, dog: null })}
              className="rounded-3xl border-2 border-dashed p-5 min-h-40 grid place-items-center text-center hover:border-primary/50 hover:bg-brand-soft/30 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out-expo hover:shadow-raise hover:-translate-y-0.5 active:scale-[0.98] firu-paw-pattern"
            >
              <div>
                <span className="mx-auto grid place-items-center size-12 rounded-2xl bg-brand-soft text-primary mb-2">
                  <Plus className="size-6" />
                </span>
                <p className="font-extrabold">{t("own.dog.addCta")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("own.dogs.addCardSub")}
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <DogDialog
        open={dogDialog.open}
        onOpenChange={(v) => setDogDialog((s) => ({ ...s, open: v }))}
        dog={dogDialog.dog}
      />
      {zones && (
        <UserEditDialog
          open={userEditOpen}
          onOpenChange={setUserEditOpen}
          user={user}
          zones={zones}
        />
      )}

      <AlertDialog open={!!deleteDog} onOpenChange={(v) => !v && setDeleteDog(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("own.dog.deleteTitle", { name: deleteDog?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("own.dog.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t("c.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive hover:bg-destructive/90"
              onClick={() => deleteDog && deleteMut.mutate(deleteDog.id)}
            >
              {deleteMut.isPending ? t("own.dog.deleting") : t("c.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
