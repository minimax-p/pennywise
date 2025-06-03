"use client";

import React, { useState } from 'react';
import { useForm } from "react-hook-form";
import { EditCategorySchema, EditCategorySchemaType } from "@/schema/categories";
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
import { Loader2, MousePointerClick } from "lucide-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EditCategory } from "@/app/(dashboard)/_actions/categories";
import { Category } from "@prisma/client";
import { toast } from "sonner";
import { useTheme } from "next-themes";

interface Props {
    category: Category;
    trigger: React.ReactNode;
}

function EditCategoryDialog({ category, trigger }: Props) {
    const [open, setOpen] = useState(false);
    const form = useForm<EditCategorySchemaType>({
        resolver: zodResolver(EditCategorySchema),
        defaultValues: {
            oldName: category.name,
            newName: category.name,
            icon: category.icon,
            type: category.type as 'income' | 'expense'
        }
    });

    const queryClient = useQueryClient();
    const theme = useTheme();

    const { mutate, isPending } = useMutation({
        mutationFn: EditCategory,
        onSuccess: async (data: Category) => {
            toast.success(`Category ${data.name} updated successfully 🎉`, {
                id: 'edit-category'
            });

            await queryClient.invalidateQueries({
                queryKey: ['categories']
            });

            setOpen(false);
        },
        onError: () => {
            toast.error("Failed to update category", {
                id: 'edit-category'
            });
        }
    });

    const onSubmit = (values: EditCategorySchemaType) => {
        toast.loading("Updating category...", {
            id: 'edit-category'
        });
        mutate(values);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit category</DialogTitle>
                    <DialogDescription>Edit your category details</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                        <FormField
                            control={form.control}
                            name="newName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Category" {...field}></Input>
                                    </FormControl>
                                    <FormDescription>Update your category name</FormDescription>
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
                                                            <MousePointerClick className="h-[48px] w-[48px]"/>
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
                                    <FormDescription>Update the emoji for your category</FormDescription>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
                <DialogFooter>
                    <Button variant={'secondary'} onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={form.handleSubmit(onSubmit)} disabled={isPending}>
                        {!isPending && "Update"}
                        {isPending && <Loader2 className="animate-spin h-5 w-5"/>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default EditCategoryDialog;