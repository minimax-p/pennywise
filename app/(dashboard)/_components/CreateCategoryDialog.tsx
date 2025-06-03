"use client";

import React, {ReactNode, useCallback, useState} from 'react';
import { useForm } from "react-hook-form";
import { CreateCategorySchema, CreateCategorySchemaType } from "@/schema/categories";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {Loader2, MousePointerClick, MousePointerClickIcon} from "lucide-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateCategory } from "@/app/(dashboard)/_actions/categories";
import { Category } from "@prisma/client";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {cn} from "@/lib/utils";
import {TransactionType} from "@/lib/types";

interface Props {
    type: TransactionType;
    successCallBack: (category: Category) => void;
    trigger?: ReactNode;
}

function CreateCategoryDialog({type, successCallBack, trigger}: Props) {
    const [open, setOpen] = useState(false);
    const form = useForm<CreateCategorySchemaType>({
        resolver: zodResolver(CreateCategorySchema),
        defaultValues: {type}
    })

    const queryClient = useQueryClient();
    const theme = useTheme();

    const {mutate, isPending} = useMutation({
        mutationFn: CreateCategory,
        onSuccess: async (data: Category) => {
            form.reset({
                name: "",
                icon: "",
                type,
            });

            toast.success(`Category ${data.name} created successfully 🎉`, {
                id: 'create-category'
            });

            successCallBack(data);

            await queryClient.invalidateQueries({
                queryKey: ['categories']
            });

            setOpen(false);
        },
        onError: () => {
            toast.error("Failed to create category", {
                id: 'create-category'
            });
        }
    });

    const onSubmit = useCallback((values: CreateCategorySchemaType)=>{
        toast.loading("Creating category...", {
            id: 'create-category'
        });
        mutate(values);
    }, [mutate]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Create <span className={cn("m-1", type === 'income' ? "text-sky-500" : "text-amber-500")}>{type}</span> category
                    </DialogTitle>
                    <DialogDescription>Categories are used to group your transactions</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Category" {...field}></Input>
                                    </FormControl>
                                    <FormDescription>Name your category!</FormDescription>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="icon"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Emoji</FormLabel>
                                    <FormControl>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-[100px] w-full">
                                                    {field.value ? (
                                                        <div className="flex flex-col items-center gap-2">
                                                            <span className='text-5xl' role='img'>{field.value}</span>
                                                            <p className="text-xs text-muted-foreground">Click to change</p>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-2">
                                                            <MousePointerClickIcon className="h-[48px] w-[48px]"/>
                                                            <p className="text-xs text-muted-foreground">Click to select</p>
                                                        </div>
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-full">
                                                <Picker data={data}
                                                        theme={theme.resolvedTheme}
                                                        onEmojiSelect={(emoji: { native: string }) => {
                                                            field.onChange(emoji.native);
                                                        }}
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </FormControl>
                                    <FormDescription>Pick an emoji for your category</FormDescription>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
                <DialogFooter>
                    <Button variant={'secondary'} onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={form.handleSubmit(onSubmit)} disabled={isPending}>
                        {!isPending && "Create"}
                        {isPending && <Loader2 className="animate-spin h-5 w-5"/>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default CreateCategoryDialog;