"use client";

// Admin → Usuarios → "Importar clientes Fase 0": paste the concierge
// spreadsheet (one line per dog), check it (dry run), then import. Each new
// owner gets a WhatsApp invite link with a prefilled message for ops.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Upload } from "lucide-react";
import { useState } from "react";
import { api, qk } from "@/lib/firu/api";
import { srvErr, useT } from "@/lib/firu/i18n";
import type { OwnerImportResultDTO } from "@/lib/firu/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type Row = {
  name: string;
  phone: string;
  zone?: string;
  addressNote?: string;
  dogs: { name: string; breed?: string; size?: "S" | "M" | "L" }[];
};

/** Split one CSV/TSV line, honouring "quoted, values". */
function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const SIZE: Record<string, "S" | "M" | "L"> = {
  s: "S", p: "S", chico: "S", pequeño: "S", small: "S",
  m: "M", mediano: "M", medium: "M",
  l: "L", g: "L", grande: "L", large: "L",
};

/** Columns: name, phone, zone, address note, dog, breed, size. A header line is skipped. */
export function parseOwnerCsv(text: string): Row[] {
  const rows: Row[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [name = "", phone = "", zone = "", addressNote = "", dog = "", breed = "", size = ""] = splitLine(raw);
    if (!/\d{6,}/.test(phone.replace(/\D/g, ""))) continue; // header or junk
    rows.push({
      name,
      phone,
      ...(zone ? { zone } : {}),
      ...(addressNote ? { addressNote } : {}),
      dogs: dog ? [{ name: dog, ...(breed ? { breed } : {}), ...(SIZE[size.toLowerCase()] ? { size: SIZE[size.toLowerCase()] } : {}) }] : [],
    });
  }
  return rows;
}

export function ImportOwnersDialog() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<OwnerImportResultDTO | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const rows = parseOwnerCsv(text);
      if (rows.length === 0) throw new Error(t("adm.imp.parseErr"));
      return api.post<OwnerImportResultDTO>("/api/admin/owners/import", { rows, dryRun });
    },
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) qc.invalidateQueries({ queryKey: qk.adminUsers });
    },
    onError: (e: Error) => toast({ title: t("adm.imp.err"), description: srvErr(e.message), variant: "destructive" }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <Upload className="size-4" /> {t("adm.users.import")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adm.imp.title")}</DialogTitle>
          <DialogDescription>{t("adm.imp.desc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={t("adm.imp.placeholder")}
          className="min-h-36 font-mono text-xs"
          aria-label={t("adm.imp.title")}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" disabled={run.isPending || !text.trim()} onClick={() => run.mutate(true)}>
            {run.isPending && run.variables === true && <Loader2 className="size-4 animate-spin" />}
            {t("adm.imp.check")}
          </Button>
          <Button
            className="rounded-full font-bold"
            disabled={run.isPending || !result?.dryRun || result.ready === 0}
            onClick={() => run.mutate(false)}
          >
            {run.isPending && run.variables === false && <Loader2 className="size-4 animate-spin" />}
            {t("adm.imp.run", { n: result?.dryRun ? result.ready : 0 })}
          </Button>
        </div>

        {result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {t("adm.imp.summary", { ready: result.ready, created: result.created, exists: result.exists, errors: result.errors })}
            </p>
            <ul className="space-y-1.5">
              {result.rows.map((r) => (
                <li key={`${r.index}-${r.phone}`} className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm">
                  <Badge variant={r.status === "error" ? "destructive" : r.status === "exists" ? "secondary" : "default"}>
                    {t(`adm.imp.status.${r.status}`)}
                  </Badge>
                  <span className="font-semibold">{r.name || "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.phone}</span>
                  {r.dogs > 0 && <span className="text-xs text-muted-foreground">{t("adm.imp.dogs", { n: r.dogs })}</span>}
                  {r.reason && <span className="text-xs text-destructive">{r.reason}</span>}
                  {r.status === "created" && r.inviteUrl && (
                    <a
                      href={r.inviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <MessageCircle className="size-3.5" /> {t("adm.imp.invite")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
