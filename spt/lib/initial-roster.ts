export type Student = {id:string;name:string;days:number[];part:string;time:string;firstDate:string;books:string[];active?:boolean;source?:{kind:"sheet";hash:string;confirmedAt:string;profileRow:number;mainRow:number;status:string;daysRaw:string}};

// The portable source has no initial student records. A confirmed roster comes from readRoster().
export const students:Student[] = [];
