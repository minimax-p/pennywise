import {Currencies} from "@/lib/currencies";

export function DateToUTCDate(date: Date){
    return new Date(
        Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds()
        )
    )
}

// Inverse of DateToUTCDate: transaction dates are stored with the local wall-clock time
// in their UTC fields, so read them back from those fields
export function UTCDateToLocalDate(date: Date){
    return new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds()
    )
}

export function GetFormatterForCurrency(currency: string){
    const locale = Currencies.find(c => c.value == currency)?.locale;
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
    })
}