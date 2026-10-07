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

// When a balance entered for a day was true. For today that is now, so transactions
// added later today still change it; for a past day (e.g. a statement date) it is the end of that day.
export function BalanceDateFromDay(day: string, now = new Date()){
    const [year, month, date] = day.split("-").map(Number);
    const isToday = year === now.getFullYear() && month === now.getMonth() + 1 && date === now.getDate();
    return isToday ? DateToUTCDate(now) : new Date(Date.UTC(year, month - 1, date, 23, 59, 59, 999));
}

// yyyy-MM-dd of a local date, the format of <input type="date">
export function ToDayString(date: Date){
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function GetFormatterForCurrency(currency: string){
    const locale = Currencies.find(c => c.value == currency)?.locale;
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
    })
}