'use client';

import React, {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {formatDistanceToNow} from "date-fns";
import {toast} from "sonner";
import {Copy, KeyRound, Loader2, Plus, Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {CreateCaptureToken, RevokeCaptureToken} from "@/app/(dashboard)/_actions/capture";
import type {GetCaptureTokensResponseType} from "@/app/api/capture-tokens/route";

function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(
        () => toast.success(`${what} copied`),
        () => toast.error("Could not copy. Select the text and copy it instead."),
    );
}

function CopyField({label, value}: { label: string, value: string }) {
    return (
        <div className="flex flex-col gap-1">
            <Label className="text-xs">{label}</Label>
            <div className="flex gap-2">
                <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()}/>
                <Button type="button" variant="outline" size="icon" onClick={() => copy(value, label)} aria-label={`Copy ${label}`}>
                    <Copy className="h-4 w-4"/>
                </Button>
            </div>
        </div>
    );
}

function ApplePayShortcut() {
    const tokensQuery = useQuery<GetCaptureTokensResponseType>({
        queryKey: ['capture-tokens'],
        queryFn: () => fetch('/api/capture-tokens').then((res) => res.json()),
    });
    const queryClient = useQueryClient();
    const revoke = useMutation({
        mutationFn: RevokeCaptureToken,
        onSuccess: async () => {
            toast.success("Key revoked");
            await queryClient.invalidateQueries({queryKey: ['capture-tokens']});
        },
    });
    const tokens = Array.isArray(tokensQuery.data) ? tokensQuery.data : [];

    return (
        <div className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
                Two shortcuts for your iPhone, using the same key. <b>Apple Pay</b> logs each Apple Pay purchase as you pay
                (set each account&apos;s Apple Wallet card name above so it lands in the right account).{" "}
                <b>Log a purchase</b> asks how much, where, how you paid and the category, for the card swipe or cash
                Apple Pay doesn&apos;t see. Run it with the Action button, Back Tap, Control Center or Siri.
                Keep importing statements: they catch everything else and fix tips.
            </p>
            {tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <span className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-muted-foreground"/>
                        <span className="font-semibold">{token.name}</span>
                        <span className="text-muted-foreground">
                            {token.lastUsedAt ? `used ${formatDistanceToNow(new Date(token.lastUsedAt), {addSuffix: true})}` : "never used"}
                        </span>
                    </span>
                    <Button variant="secondary" size="icon" aria-label={`Revoke ${token.name}`} disabled={revoke.isPending}
                            onClick={() => revoke.mutate(token.id)} className="hover:bg-red-400 hover:text-white">
                        <Trash2 className="h-4 w-4"/>
                    </Button>
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                <CreateKeyDialog variant="apple-pay"/>
                <CreateKeyDialog variant="log"/>
            </div>
        </div>
    );
}

function CreateKeyDialog({variant}: { variant: "apple-pay" | "log" }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("iPhone");
    const [token, setToken] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const endpoint = `${origin}/api/capture`;
    const title = variant === "log" ? "Log a purchase shortcut" : "Apple Pay shortcut";

    const create = useMutation({
        mutationFn: () => CreateCaptureToken(name),
        onSuccess: async (result) => {
            setToken(result.token);
            await queryClient.invalidateQueries({queryKey: ['capture-tokens']});
        },
        onError: () => {
            toast.error("Could not create a key");
        },
    });

    return (
        <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            if (!next) setToken(null);
        }}>
            <DialogTrigger asChild>
                <Button className="gap-2" variant={variant === "log" ? "outline" : "default"}>
                    <Plus className="h-4 w-4"/>{variant === "log" ? "Set up Log a purchase" : "Set up Apple Pay"}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {token ? "Copy the key now. It is not shown again." : "Create a key for your iPhone, then add the automation."}
                    </DialogDescription>
                </DialogHeader>
                {!token ? (
                    <form className="flex flex-col gap-4" onSubmit={(e) => {
                        e.preventDefault();
                        create.mutate();
                    }}>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="key-name">Device name</Label>
                            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required/>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={create.isPending || !name.trim()}>
                                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : "Create key"}
                            </Button>
                        </DialogFooter>
                    </form>
                ) : variant === "log" ? (
                    <LogShortcutSteps origin={origin} token={token}/>
                ) : (
                    <div className="flex flex-col gap-4 text-sm">
                        <CopyField label="URL" value={endpoint}/>
                        <CopyField label="Authorization header" value={`Bearer ${token}`}/>
                        <ol className="list-decimal space-y-2 pl-5">
                            <li>On your iPhone, open <b>Shortcuts</b>, go to <b>Automation</b> and tap <b>+</b>.</li>
                            <li>Choose <b>Transaction</b>, select your cards, leave the rest as is, choose <b>Run Immediately</b> and tap <b>Next</b>.</li>
                            <li>Tap <b>New Blank Automation</b> and add the action <b>Get Contents of URL</b>. Paste the URL above.</li>
                            <li>Tap <b>Show More</b>: set <b>Method</b> to <b>POST</b>, add a header named <b>Authorization</b> with the value above, and set <b>Request Body</b> to <b>JSON</b>.</li>
                            <li>
                                Add three text fields to the JSON: <code>amount</code>, <code>merchant</code> and <code>card</code>.
                                For each value, tap <b>Shortcut Input</b> and pick <b>Amount</b>, <b>Merchant</b> and <b>Card or Pass</b>.
                            </li>
                            <li>Optional: add <b>Show Notification</b> with the <b>message</b> from <b>Contents of URL</b> to see what was logged.</li>
                        </ol>
                        <p className="text-muted-foreground">
                            Pay with Apple Pay once to test it. The purchase shows up on the Transactions page within seconds.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// Builds "Log a purchase": four questions, answered from lists Pennywise keeps in order of use
function LogShortcutSteps({origin, token}: { origin: string, token: string }) {
    return (
        <div className="flex flex-col gap-4 text-sm">
            <CopyField label="Lists URL" value={`${origin}/api/capture/options`}/>
            <CopyField label="Log URL" value={`${origin}/api/capture`}/>
            <CopyField label="Authorization header" value={`Bearer ${token}`}/>
            <ol className="list-decimal space-y-2 pl-5">
                <li>Open <b>Shortcuts</b>, tap <b>+</b> and name the shortcut <b>Log a purchase</b>.</li>
                <li>
                    Add <b>Get Contents of URL</b> with the Lists URL. Under <b>Show More</b>, add a header named
                    <b> Authorization</b> with the value above.
                </li>
                <li>Add <b>Ask for Input</b>: Input Type <b>Number</b>, prompt <b>How much?</b></li>
                <li>
                    Add <b>Get Dictionary Value</b>: Value for <code>places</code> in Contents of URL. Then <b>Choose from List</b>,
                    prompt <b>Where?</b>
                </li>
                <li>
                    Add <b>If</b> Chosen Item <b>is</b> <code>New place…</code>. Inside it, <b>Ask for Input</b> (Text, prompt
                    <b> Where?</b>). Under <b>Otherwise</b>, add <b>Text</b> containing Chosen Item.
                </li>
                <li>
                    Add <b>Get Dictionary Value</b> for <code>accounts</code> in Contents of URL, then <b>Choose from List</b>,
                    prompt <b>Paid with?</b>
                </li>
                <li>
                    Add <b>Get Dictionary Value</b> for <code>categories</code> in Contents of URL, then <b>Choose from List</b>,
                    prompt <b>Category?</b>
                </li>
                <li>
                    Add another <b>Get Contents of URL</b> with the Log URL: <b>Method POST</b>, the same Authorization
                    header, <b>Request Body JSON</b> with four text fields: <code>amount</code> = Provided Input,
                    {" "}<code>merchant</code> = If Result, <code>account</code> = the Paid with choice, <code>category</code> = the
                    Category choice.
                </li>
                <li>Add <b>Get Dictionary Value</b> for <code>message</code>, then <b>Show Notification</b> with it.</li>
            </ol>
            <p className="text-muted-foreground">
                To run it in one press: Settings → Action Button → Shortcut (iPhone 15 Pro and newer), Settings → Accessibility →
                Touch → Back Tap → Double Tap, or add it to Control Center. &ldquo;Hey Siri, log a purchase&rdquo; works too.
                Pick <b>Sort later</b> when you&apos;re in a hurry; it waits on the Sort page.
            </p>
        </div>
    );
}

export default ApplePayShortcut;
