import React from 'react';
import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {Button} from "@/components/ui/button";
import CreateTransactionDialog from "@/app/(dashboard)/_components/CreateTransactionDialog";
import Overview from "@/app/(dashboard)/_components/Overview";
import History from "@/app/(dashboard)/_components/History";
import {ArrowRightLeft, CirclePlus} from "lucide-react";
import AccountsSummary from "@/app/(dashboard)/_components/AccountsSummary";
import ReviewBanner from "@/app/(dashboard)/_components/ReviewBanner";
import CreateTransferDialog from "@/app/(dashboard)/_components/CreateTransferDialog";

async function Page() {
    const user = await currentUser();
    if(!user){
        redirect('/login');
    }

    const userSettings = await prisma.userSettings.findUnique({
        where:{
            userId: user.id,
        }
    });

    if (!userSettings){
        redirect('/wizard');
    }

    return (
        <div className="h-full bg-background">
            <div className="border-b bg-card">
                <div className="container flex flex-wrap items-center justify-between gap-6 py-8 w-full">
                    <p className="text-3xl font-bold">
                        Welcome back{user.firstName ? `, ${user.firstName}` : ''}! 👋🏻
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <CreateTransactionDialog trigger={<Button variant={"outline"} className="bg-[#C1EE9F] text-black hover:bg-sky-600 hover:text-white font-mono">
                            <CirclePlus />
                            Income
                        </Button>}
                        type="income"/>
                        <CreateTransactionDialog trigger={<Button variant={"outline"} className="bg-[#F8D862] text-black hover:bg-amber-600 hover:text-white font-mono">
                            <CirclePlus />
                            Expense
                        </Button>} type="expense"/>
                        <CreateTransferDialog trigger={<Button variant={"outline"} className="bg-violet-300 text-black hover:bg-violet-600 hover:text-white font-mono">
                            <ArrowRightLeft />
                            Transfer
                        </Button>}/>
                    </div>
                </div>
            </div>
            <ReviewBanner />
            <AccountsSummary userSettings={userSettings} />
            <Overview userSettings={userSettings} />
            <History userSettings={userSettings} />
        </div>
    )
}

export default Page;