'use client';

import { useState } from 'react';
import { Plus, Copy, Check, Sparkles, Loader2, X } from 'lucide-react';
import { generateTesterInvitesAction } from '@/actions/admin/tester-invites';

interface Props {
  tenantId: string;
  onSuccess: () => void;
}

export function GenerateBatchModal({ tenantId, onSuccess }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [count, setCount] = useState(10);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateTesterInvitesAction({ count, note, tenantId });
      if (res.success) {
        const urls = res.invites.map((i) => i.url);
        setGeneratedLinks(urls);
        onSuccess();
      } else {
        setError(res.error || 'Ошибка генерации ссылок');
      }
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(generatedLinks.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleClose = () => {
    setIsOpen(false);
    setGeneratedLinks([]);
    setError(null);
    setNote('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-primary-foreground bg-primary rounded-xl shadow-xs hover:bg-primary/90 transition-all active:scale-95"
      >
        <Plus className="w-4 h-4" /> Создать ссылки для тестировщиков
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2 font-bold text-base text-foreground">
                <Sparkles className="w-4 h-4 text-primary" />
                Генерация ссылок для тестировщиков
              </div>
              <button onClick={handleClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {generatedLinks.length === 0 ? (
                <>
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    Каждая сгенерированная ссылка действует строго <strong>14 дней</strong> и предназначена для одного тестировщика (1 email = 1 ссылка). После перехода и регистрации пользователь получает статус <code>isTester</code>.
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Количество ссылок (по умолчанию 10)</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={count}
                      onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                      className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Заметка / группа (опционально)</label>
                    <input
                      type="text"
                      placeholder="Например: Тестовая группа Telegram 1"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {error && <div className="text-xs text-destructive bg-destructive/10 p-3 rounded-xl">{error}</div>}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-success/10 border border-success/20 rounded-xl text-xs text-success font-medium">
                    Успешно сгенерировано {generatedLinks.length} ссылок (срок действия 14 дней).
                  </div>

                  <button
                    onClick={copyAll}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-primary-foreground bg-primary rounded-xl shadow-xs hover:bg-primary/90 transition-all active:scale-95"
                  >
                    {copiedAll ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    {copiedAll ? 'Все ссылки скопированы в буфер!' : `Скопировать все ${generatedLinks.length} ссылок`}
                  </button>

                  <div className="max-h-60 overflow-y-auto space-y-1.5 p-2 bg-muted/30 rounded-xl border border-border/50 text-xs font-mono">
                    {generatedLinks.map((url, i) => (
                      <div key={i} className="p-1.5 bg-card rounded-md border border-border/40 select-all truncate">
                        {url}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/20">
              {generatedLinks.length === 0 ? (
                <>
                  <button onClick={handleClose} className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl">
                    Отмена
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-primary-foreground bg-primary rounded-xl hover:bg-primary/90 disabled:opacity-50"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Сгенерировать ({count})
                  </button>
                </>
              ) : (
                <button onClick={handleClose} className="px-4 py-2 text-xs font-semibold text-foreground bg-card border border-border hover:bg-muted rounded-xl">
                  Готово
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
