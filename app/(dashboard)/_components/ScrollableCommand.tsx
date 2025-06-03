"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const frameworks = [
  { value: "next.js", label: "Next.js" },
  { value: "sveltekit", label: "SvelteKit" },
  { value: "nuxt.js", label: "Nuxt.js" },
  { value: "remix", label: "Remix" },
  { value: "astro", label: "Astro" },
  { value: "gatsby", label: "Gatsby" },
  { value: "vue", label: "Vue.js" },
  { value: "react", label: "React" },
  { value: "angular", label: "Angular" },
  { value: "svelte", label: "Svelte" },
  { value: "alpine", label: "Alpine.js" },
  { value: "lit", label: "Lit" },
  { value: "solid", label: "Solid" },
  { value: "qwik", label: "Qwik" },
]

export default function ScrollablePopover() {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [search, setSearch] = React.useState("")

  const filteredFrameworks = frameworks.filter((framework) =>
      framework.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[200px] justify-between"
          >
            {value
                ? frameworks.find((framework) => framework.value === value)?.label
                : "Select framework..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Input
                placeholder="Search framework..."
                className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredFrameworks.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto">
                {filteredFrameworks.map((framework) => (
                    <div
                        key={framework.value}
                        className={cn(
                            "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                            value === framework.value ? "bg-accent text-accent-foreground" : "text-popover-foreground",
                            "hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => {
                          setValue(framework.value)
                          setOpen(false)
                        }}
                    >
                      <Check
                          className={cn(
                              "mr-2 h-4 w-4",
                              value === framework.value ? "opacity-100" : "opacity-0"
                          )}
                      />
                      {framework.label}
                    </div>
                ))}
              </div>
          ) : (
              <div className="text-center py-6 text-sm">No framework found.</div>
          )}
        </PopoverContent>
      </Popover>
  )
}