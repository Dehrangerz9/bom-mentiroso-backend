import { Category, Question } from './types';
import data from './data/questions.json';

export const categories: Category[] = data.categories;
export const questions: Question[] = data.questions as Question[];
