export type DocumentType =
  | 'cpf'
  | 'cnpj'
  | 'passport'
  | 'id_card'
  | 'proof_of_address'
  | 'power_of_attorney';

export type HolderType = 'individual' | 'business';

export interface DocumentRequirement {
  type: DocumentType;
  label: string;
  description: string;
  accept: string;  // MIME types
}

export interface CountryRequirement {
  needsDocs: boolean;
  holderTypes: HolderType[];
  requiredDocs: Record<HolderType, DocumentType[]>;
  processingDays: number;
  notes: string;
}

export const DOCUMENT_LABELS: Record<DocumentType, DocumentRequirement> = {
  cpf: {
    type: 'cpf',
    label: 'CPF',
    description: 'Cópia do CPF ou documento com CPF visível',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  cnpj: {
    type: 'cnpj',
    label: 'Cartão CNPJ',
    description: 'Comprovante de inscrição e situação cadastral (site Receita Federal)',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  passport: {
    type: 'passport',
    label: 'Passaporte',
    description: 'Página de dados do passaporte válido',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  id_card: {
    type: 'id_card',
    label: 'Documento de identidade',
    description: 'RG, CNH ou documento oficial com foto',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  proof_of_address: {
    type: 'proof_of_address',
    label: 'Comprovante de endereço',
    description: 'Conta de luz, água, telefone ou banco — emitido nos últimos 3 meses',
    accept: 'image/jpeg,image/png,application/pdf',
  },
  power_of_attorney: {
    type: 'power_of_attorney',
    label: 'Procuração',
    description: 'Procuração autorizando a contratação do número em nome da empresa',
    accept: 'image/jpeg,image/png,application/pdf',
  },
};

export const COUNTRY_REQUIREMENTS: Record<string, CountryRequirement> = {
  BR: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['cpf', 'proof_of_address'],
      business:   ['cnpj', 'proof_of_address', 'power_of_attorney'],
    },
    processingDays: 3,
    notes: 'Exigência da ANATEL. Prazo de análise: até 3 dias úteis.',
  },
  AR: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['id_card', 'proof_of_address'],
      business:   ['id_card', 'proof_of_address'],
    },
    processingDays: 5,
    notes: 'Exigência da ENACOM. Prazo de análise: até 5 dias úteis.',
  },
  MX: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['id_card', 'proof_of_address'],
      business:   ['id_card', 'proof_of_address'],
    },
    processingDays: 3,
    notes: 'Exigência do IFT. Prazo de análise: até 3 dias úteis.',
  },
  CO: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['id_card', 'proof_of_address'],
      business:   ['id_card', 'proof_of_address'],
    },
    processingDays: 5,
    notes: 'Exigência da CRC. Prazo de análise: até 5 dias úteis.',
  },
  PT: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['id_card', 'proof_of_address'],
      business:   ['id_card', 'proof_of_address'],
    },
    processingDays: 3,
    notes: 'Exigência da ANACOM. Prazo de análise: até 3 dias úteis.',
  },
  ES: {
    needsDocs: true,
    holderTypes: ['individual', 'business'],
    requiredDocs: {
      individual: ['id_card', 'proof_of_address'],
      business:   ['id_card', 'proof_of_address'],
    },
    processingDays: 3,
    notes: 'Exigência da CNMC. Prazo de análise: até 3 dias úteis.',
  },
  // Países sem KYC — compra imediata
  US: { needsDocs: false, holderTypes: ['individual','business'], requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '' },
  CA: { needsDocs: false, holderTypes: ['individual','business'], requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '' },
  GB: { needsDocs: false, holderTypes: ['individual','business'], requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '' },
  AU: { needsDocs: false, holderTypes: ['individual','business'], requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '' },
  NZ: { needsDocs: false, holderTypes: ['individual','business'], requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '' },
};

export function getCountryRequirement(countryCode: string): CountryRequirement {
  return COUNTRY_REQUIREMENTS[countryCode] ?? {
    needsDocs: false, holderTypes: ['individual','business'],
    requiredDocs: { individual: [], business: [] }, processingDays: 0, notes: '',
  };
}
