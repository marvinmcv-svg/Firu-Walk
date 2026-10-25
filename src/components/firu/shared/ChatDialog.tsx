"use client";

// In-app chat for a booking thread (owner ↔ walker).
// History via REST /api/messages, realtime relay via the live-service socket,
// WhatsApp deep-link fallback always available.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { api } from "@/lib/firu/api";
import { springSnappy } from "@/lib/firu/motion";
import {
  getSocket,
  joinChat,
  leaveChat,
  sendChat,
  type ChatMessage,
} from "@/lib/firu/socket";
import { useFiruSession } from "@/lib/firu/session";
import { useT } from "@/lib/firu/i18n";
import { Avatar, whatsappHref } from "./bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/lib/firu/dates";

interface DbMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export function ChatDialog({
  open,
  onOpenChange,
  threadId,
  otherName,
  otherAvatar,
  otherPhone,
  contextLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  threadId: string;
  otherName: string;
  otherAvatar?: string | null;
  otherPhone?: string | null;
  contextLabel?: string;
}) {
  const user = useFiruSession((s) => s.user);
  const { t } = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: history } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: () =>
      api.get<DbMessage[]>(`/api/messages?threadId=${threadId}`),
    enabled: open && !!threadId,
  });

  // socket wiring
  useEffect(() => {
    if (!open || !user || !threadId) return;
    const socket = getSocket();
    joinChat({ threadId, userId: user.id, userName: user.name, role: user.role });

    const onMessage = (msg: ChatMessage) => {
      if (msg.threadId !== threadId) return;
      setLive((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
      );
      // persist ownership: if I'm the sender, the REST layer already saved it;
      // if I'm the receiver, save via REST so history stays durable.
      if (msg.fromId !== user.id && !msg.id.startsWith("db-")) {
        api
          .post("/api/messages", { threadId, body: msg.body, clientId: msg.id })
          .catch(() => undefined);
      }
      setTyping(null);
    };
    const onTyping = (p: { threadId: string; userName: string }) => {
      if (p.threadId === threadId) setTyping(p.userName.split(" ")[0]);
      setTimeout(() => setTyping(null), 3500);
    };
    socket.on("chat:message", onMessage);
    socket.on("chat:typing", onTyping);

    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:typing", onTyping);
      leaveChat(threadId);
    };
  }, [open, threadId, user]);

  // merge db history + live messages (dedupe by id)
  const messages: { id: string; mine: boolean; name: string; body: string; at: string }[] = [
    ...(history ?? []).map((m) => ({
      id: m.id,
      mine: m.senderId === user?.id,
      name: m.senderName,
      body: m.body,
      at: m.createdAt,
    })),
    ...live.map((m) => ({
      id: m.id,
      mine: m.fromId === user?.id,
      name: m.fromName,
      body: m.body,
      at: new Date(m.ts).toISOString(),
    })),
  ]
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing]);

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      if (!user) throw new Error(t("sh.chat.noSession"));
      // persist via REST, then relay live
      const saved = await api
        .post<DbMessage>("/api/messages", { threadId, body })
        .catch(() => null);
      sendChat({
        threadId,
        fromId: user.id,
        fromName: user.name,
        role: user.role,
        body,
      });
      return saved;
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-3 border-b bg-brand-soft/60">
          <DialogTitle className="flex items-center gap-2.5">
            <Avatar src={otherAvatar} name={otherName} size="sm" />
            <div className="min-w-0">
              <p className="text-base leading-tight truncate">{otherName}</p>
              {contextLabel && (
                <DialogDescription className="text-xs truncate">{contextLabel}</DialogDescription>
              )}
            </div>
            {otherPhone && (
              <a
                href={whatsappHref(otherPhone, t("sh.chat.waGreeting"))}
                target="_blank"
                rel="noreferrer"
                className="ml-auto"
                title={t("sh.chat.waOpen")}
              >
                <Button variant="outline" size="icon" className="rounded-full size-9">
                  <MessageCircle className="size-4 text-primary" />
                </Button>
              </a>
            )}
          </DialogTitle>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto px-4 py-3 space-y-2.5 bg-muted/30"
        >
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t("sh.chat.empty")}
            </p>
          )}
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={springSnappy}
              className={cn("flex", m.mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-3.5 py-2 shadow-sm",
                  m.mine
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card border rounded-bl-md"
                )}
              >
                <p className="text-sm leading-snug break-words">{m.body}</p>
                <p
                  className={cn(
                    "text-[10px] mt-1",
                    m.mine ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  {fmtTime(m.at)}
                </p>
              </div>
            </motion.div>
          ))}
          {typing && (
            <p className="text-xs text-muted-foreground italic">{t("sh.chat.typing", { name: typing })}</p>
          )}
        </div>

        <form
          className="flex items-center gap-2 p-3 border-t"
          onSubmit={(e) => {
            e.preventDefault();
            const body = draft.trim();
            if (body) sendMut.mutate(body);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (user)
                getSocket().emit("chat:typing", {
                  threadId,
                  userId: user.id,
                  userName: user.name,
                });
            }}
            placeholder={t("sh.chat.placeholder")}
            className="rounded-full"
          />
          <Button
            type="submit"
            size="icon"
            className="rounded-full size-10 shrink-0"
            disabled={sendMut.isPending || !draft.trim()}
            aria-label={t("c.send")}
          >
            {sendMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
