import React from 'react';
import {currentUser} from "@clerk/nextjs/server";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {Button} from "@/components/ui/button";
import CreateTransactionDialog from "@/app/(dashboard)/_components/CreateTransactionDialog";
import Overview from "@/app/(dashboard)/_components/Overview";
import History from "@/app/(dashboard)/_components/History";
import {CirclePlus} from "lucide-react";

async function Page() {
    const user = await currentUser();
    if(!user){
        redirect('/sign-in');
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
                        Hello, {user.firstName}! 👋🏻
                    </p>
                    <div className="flex items-center gap-3">
                        <CreateTransactionDialog trigger={<Button variant={"outline"} className="bg-[#C1EE9F] text-black hover:bg-lime-600 hover:text-white">
                            <CirclePlus />
                            Income
                        </Button>}
                        type="income"/>
                        <CreateTransactionDialog trigger={<Button variant={"outline"} className="bg-[#F8D862] text-black hover:bg-amber-600 hover:text-white">
                            <CirclePlus />
                            Expense
                        </Button>} type="expense"/>
                    </div>
                </div>
            </div>
            <Overview userSettings={userSettings} />
            <History userSettings={userSettings} />
        </div>
    )
}

export default Page;