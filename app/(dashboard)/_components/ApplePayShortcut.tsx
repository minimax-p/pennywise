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
                An automation in the Shortcuts app sends each Apple Pay purchase to Pennywise as you pay. It only sees
                Apple Pay taps, so keep importing statements to catch online purchases and correct tips.
                Set each account&apos;s Apple Wallet card name above so purchases land in the right account.
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
            <div>
                <CreateKeyDialog/>
            </div>
        </div>
    );
}

function CreateKeyDialog() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("iPhone");
    const [token, setToken] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const endpoint = typeof window === 'undefined' ? '/api/capture' : `${window.location.origin}/api/capture`;

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
                <Button className="gap-2 font-mono"><Plus className="h-4 w-4"/>Set up the shortcut</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>Apple Pay shortcut</DialogTitle>
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

export default ApplePayShortcut;
