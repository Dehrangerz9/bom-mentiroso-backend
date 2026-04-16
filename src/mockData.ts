import path from 'path';
import fs from 'fs';
import { Category, Question } from './types';
import categoriesData from './data/categories.json';

export const categories: Category[] = categoriesData.categories;

const categoryIds = [
  'thoughtworks', 'cultura-pop', 'geografia', 'historia-geral',
  'ciencia-natureza', 'esportes', 'literatura', 'gastronomia',
  'artes', 'astronomia', 'linguas', 'jogos', 'economia', 'ecologia',
];
const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const questions: Question[] = categoryIds.flatMap((cat) =>
  levels.flatMap((level) => {
    const filePath = path.join(__dirname, 'data', `questions-${cat}-${level}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (JSON.parse(raw) as { questions: Question[] }).questions;
  })
);
