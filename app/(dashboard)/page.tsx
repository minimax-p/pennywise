import React from 'react';
import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import HomeView from "@/app/(dashboard)/_components/HomeView";

async function Page() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const userSettings = await prisma.userSettings.findUnique({where: {userId: user.id}});
    if (!userSettings) {
        redirect('/wizard');
    }

    return <HomeView firstName={user.firstName}/>;
}

export default Page;
