import React from 'react';
import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import LoginForm from "@/app/(auth)/login/LoginForm";

async function LoginPage({searchParams}: { searchParams: { next?: string } }) {
    if (await currentUser()) {
        redirect('/');
    }
    return <LoginForm next={searchParams.next ?? "/"}/>;
}

export default LoginPage;
