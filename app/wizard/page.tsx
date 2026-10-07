import React from 'react';
import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {Separator} from "@/components/ui/separator";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";
import PennyMark from "@/components/PennyMark";
import {CurrencyComboBox} from "@/components/CurrencyComboBox";

async function Page() {
    const user = await currentUser();
    if (!user){
        redirect("/login");
    }
    return (
        <div className="container flex max-w-2xl flex-col items-center justify-between gap-4 py-8">
            <PennyMark className="h-24 w-24"/>
            <div>
                <h1 className="text-center font-display text-3xl font-bold">
                    Welcome{user.firstName && <span className="ml-2">{user.firstName}</span>}! 👋
                </h1>
                <h2 className="mt-4 text-center text-base text-muted-foreground">
                    Let&apos;s start with your currency
                </h2>
                <h3 className="mt-2 text-center text-sm text-muted-foreground">
                    You can change these settings at any time
                </h3>
            </div>
            <Separator/>
            <Card className="w-full">
                <CardHeader>
                    <CardTitle>Currency</CardTitle>
                    <CardDescription>Set your default currency for transactions</CardDescription>
                </CardHeader>
                <CardContent>
                    <CurrencyComboBox></CurrencyComboBox>
                </CardContent>
            </Card>
            <Separator/>
            <Button size="lg" className="w-full" asChild>
                <Link href={"/"}>Done, take me home</Link>
            </Button>
        </div>
    );
}

export default Page;