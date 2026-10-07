'use client';

import React from 'react';
import {useFormState, useFormStatus} from "react-dom";
import {Loader2, Lock} from "lucide-react";
import {Login, LoginState} from "@/app/(auth)/login/actions";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";

function SubmitButton() {
    const {pending} = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin"/> : "Unlock"}
        </Button>
    );
}

function LoginForm({next}: { next: string }) {
    const [state, formAction] = useFormState<LoginState, FormData>(Login, {error: null});

    return (
        <Card className="w-[340px]">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5"/> Pennywise is locked</CardTitle>
                <CardDescription>Enter your password to continue</CardDescription>
            </CardHeader>
            <CardContent>
                <form action={formAction} className="flex flex-col gap-4">
                    {/* Lets the iCloud Keychain and other password managers save the password */}
                    <input type="text" name="username" autoComplete="username" value="pennywise" readOnly tabIndex={-1} aria-hidden className="sr-only"/>
                    <input type="hidden" name="next" value={next}/>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required/>
                    </div>
                    {state.error && <p className="text-sm text-destructive">{state.error}</p>}
                    <SubmitButton/>
                </form>
            </CardContent>
        </Card>
    );
}

export default LoginForm;
